const {readSettings}=require('./notification-settings');
const {changeAccount,summarize,notificationMessage,cents}=require('./customer-account');
const endpoint='https://dtmapp.web.app/api/dtm-access/drivewise/mail';
const defaultRecipients=['carrepair@downtownmin.org'];
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
function recipients(input) {
  const values=[...new Set((Array.isArray(input)?input:String(input||'').split(/[;,\n]/)).map(v=>String(v).trim().toLowerCase()).filter(Boolean))];
  if (!values.length||values.length>8||values.some(v=>v.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(v))) fail('Enter one to eight valid notification email addresses.');
  return values;
}
function customerWorkflow({db,stateRef,workCollection,fetcher=fetch}) {
  const accounts=db.collection('drivewiseCustomerAccounts'),outbox=db.collection('drivewiseNotifications'),settings=db.collection('drivewiseSettings').doc('notifications'),workflowSettings=db.collection('drivewiseSettings').doc('workflow');
  const settingsValue=snapshot=>snapshot.data()?.recipients||defaultRecipients;
  return {
    // Save a new request and any initial agreed charge in one transaction.
    // This never rewrites the existing repair list from an earlier page load.
    async createRepair(repair,actor,initialCharge,logChange) {
      if(!String(repair.payer||'').trim())fail('Payer is required.');
      const hasCharge=initialCharge!==undefined&&initialCharge!==null&&String(initialCharge).trim()!=='';
      if(hasCharge)cents(initialCharge);
      return db.runTransaction(async tx=>{
        const ref=stateRef(),snapshot=await tx.get(ref),state=snapshot.data()?.state;
        if(!state)fail('DriveWise records are unavailable.',503);
        if((state.repairs||[]).some(r=>r.id===repair.id))fail('This repair was already saved. Refresh the record before making further changes.',409);
        state.repairs=[repair,...(state.repairs||[])];
        logChange(state,actor,'Add DriveWise record',`${actor} saved repair record for ${repair.ownerName}.`);
        tx.set(ref,{state,updatedAt:new Date()},{merge:true});
        if(hasCharge)tx.create(accounts.doc(repair.id),changeAccount({},{action:'charge',amount:initialCharge},actor,'').account);
      });
    },
    async snapshot() {
      const [rows,pending,config]=await Promise.all([accounts.get(),outbox.where('sentAt','==',null).limit(100).get(),settings.get()]);
      return {accounts:Object.fromEntries(rows.docs.map(doc=>[doc.id,doc.data()])),notifications:{recipients:settingsValue(config),pending:pending.size,
        failed:pending.docs.filter(doc=>doc.data().attempts>0).length}};
    },
    async saveSettings(value,actor) {const emails=recipients(value);await settings.set({recipients:emails,updatedBy:actor,updatedAt:new Date().toISOString()});return emails;},
    async assertOpen(id) {if((await accounts.doc(id).get()).data()?.closedAt)fail('The customer balance is paid and this repair is closed. Use Customer payments to correct the charge or reverse an incorrect payment before editing.',409);},
    async assertDeletable(id) {if((await accounts.doc(id).get()).exists)fail('This repair has customer account history and cannot be deleted.',409);},
    async mutateAccount(id,input,actor) {
      if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id||''))fail('Choose a repair.');
      return db.runTransaction(async tx=>{
        const [state,account,work,config]=await Promise.all([tx.get(stateRef()),tx.get(accounts.doc(id)),tx.get(workCollection.doc(id)),tx.get(workflowSettings)]);
        const repair=state.data()?.state?.repairs?.find(r=>r.id===id);
        if(!repair||repair.recordType==='shopSupply'||(repair.historicalComplete&&!repair.correctionOpen&&!account.exists))fail('Reopen historical repairs for corrections before creating their customer account.',409);
        const result=changeAccount(account.data(),input,actor,work.data()?.completedAt||(repair.historicalComplete?'historical-complete':''));
        tx.set(accounts.doc(id),result.account);
        if(result.event)tx.create(outbox.doc(result.event.id),{...result.event,repairId:id,recipients:[readSettings(config.data()).accountingEmail],sentAt:null,attempts:0});
        return result.account;
      });
    },
    // Completion and its notification are committed together. Customer balance
    // closure is separate from the legacy vendor invoice/payment state.
    async mutateWork(id,change) {
      return db.runTransaction(async tx=>{
        const ref=workCollection.doc(id);
        const [work,account,config]=await Promise.all([tx.get(ref),tx.get(accounts.doc(id)),tx.get(workflowSettings)]);
        const previous=work.data()||{},next=change(previous);
        tx.set(ref,next);
        if(next.completedAt&&!previous.completedAt) {
          const summary=summarize(account.data(),next.completedAt);
          tx.set(accounts.doc(id),summary);
          const event={id:'completion-'+id,kind:'completion',repairId:id,createdAt:new Date().toISOString(),workSnapshot:next,accountSnapshot:summary,
            recipients:readSettings(config.data()).carRepairRequestEmails,sentAt:null,attempts:0};
          tx.create(outbox.doc(event.id),event);
        }
        return next;
      });
    },
    async flush(limit=5) {
      const pending=await outbox.where('sentAt','==',null).limit(100).get();
      let sent=0,attempted=0;
      for(const row of pending.docs) {
        if(attempted>=limit)break;
        const claim=await db.runTransaction(async tx=>{
          const doc=await tx.get(row.ref),event=doc.data(),now=Date.now();
          if(!event||event.sentAt||(event.leaseUntil||0)>now||(event.nextAttempt||0)>now)return null;
          tx.update(row.ref,{leaseUntil:now+180000,attempts:(event.attempts||0)+1});return event;
        });
        if(!claim)continue;
        attempted++;
        try {
          const state=(await stateRef().get()).data()?.state;
          const repair=state?.repairs?.find(r=>r.id===claim.repairId);
          if(!repair)throw Error('Repair unavailable.');
          const identity=await fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience='+encodeURIComponent(endpoint)+'&format=full',{
            headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(10000)});
          if(!identity.ok)throw Error('Cloud identity unavailable.');
          const result=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+await identity.text(),Origin:'https://dtm-drivewise-test.web.app','Content-Type':'application/json'},
            body:JSON.stringify(notificationMessage(claim,repair)),signal:AbortSignal.timeout(60000)});
          if(!result.ok)throw Error('Notification sender unavailable.');
          await row.ref.update({sentAt:new Date().toISOString(),leaseUntil:0,lastError:''});sent++;
        } catch {
          await row.ref.update({leaseUntil:0,nextAttempt:Date.now()+15*60000,lastError:'Delivery pending; automatic retry scheduled.'});
        }
      }
      return {sent,attempted};
    },
    async retry() {const pending=await outbox.where('sentAt','==',null).limit(100).get();await Promise.all(pending.docs.map(row=>row.ref.update({nextAttempt:0})));},
  };
}
module.exports={customerWorkflow,recipients};
