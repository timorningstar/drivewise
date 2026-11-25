const {assertAccountingCorrection}=require('./correction-access');
const {randomUUID}=require('node:crypto');
const {changeAccount}=require('./customer-account');
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
function statementDate(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Enter the vendor statement date once for the selected invoices.');
 return value;
}
function correctionReason(input) {
 const reason=String(input.reason||'').trim();
 if(!reason||reason.length>600)fail('Enter a reason, up to 600 characters.');
 return reason;
}
const version=r=>Number.isSafeInteger(r.revision)?r.revision:0;
function reopenRepair(repair,input,actor,now=new Date().toISOString()) {
 if(repair.recordType==='shopSupply')fail('Choose a vehicle repair.');
 const reason=correctionReason(input);
 if(repair.correctionOpen)return repair;
 return {...repair,correctionOpen:true,revision:version(repair)+1,updatedAt:now,
   correctionHistory:[...(repair.correctionHistory||[]),{id:randomUUID(),reason,openedAt:now,openedBy:actor,finishedAt:''}]};
}
function reverseInvoice(invoice,input,actor,now=new Date().toISOString()) {
 if(input.firstConfirmed!==true||input.secondConfirmed!==true)fail('Confirm both Yes steps before reversing an invoice.');
 const reason=correctionReason(input);
 if(!/^[a-f0-9-]{36}$/.test(input.operationId||''))fail('Reopen the reversal window and try again.');
 const retry=(invoice.statementHistory||[]).find(row=>row.operationId===input.operationId);
 if(retry){if(retry.reason!==reason)fail('This reversal was already recorded with a different reason.',409);return invoice;}
 if(!invoice.statementComplete)fail('This invoice is already open. Refresh the invoice view.',409);
 return {...invoice,statementChecked:false,statementComplete:false,statementDate:'',statementBatchId:'',statementCompletedAt:'',statementCompletedBy:'',
   statementHistory:[...(invoice.statementHistory||[]),{action:'reversed',operationId:input.operationId,at:now,by:actor,reason,confirmations:2,
     previous:{statementDate:invoice.statementDate||'',batchId:invoice.statementBatchId||'',completedAt:invoice.statementCompletedAt||'',completedBy:invoice.statementCompletedBy||'',paid:Boolean(invoice.paid),paymentBatchId:invoice.paymentBatchId||'',invoiceNumber:invoice.invoiceNumber||'',vendor:invoice.vendor||'',cost:invoice.cost||0,invoiceFile:invoice.invoiceFile||null}}]};
}
function closeStatements(state,input,actor,now=new Date().toISOString()) {
 const date=statementDate(input.statementDate);
 const rows=Array.isArray(input.invoices)?input.invoices:[];
 const keys=new Set(rows.map(i=>`${i.repairId}:${i.invoiceId}`));
 if(!keys.size||keys.size>500)fail('Choose one to 500 invoices to complete.');
 const selected=state.repairs.flatMap(r=>(r.invoices||[]).filter(i=>keys.has(`${r.id}:${i.id}`)));
 if(selected.length!==keys.size)fail('Some selected invoices changed or no longer exist. Refresh and try again.',409);
 if(selected.every(i=>i.statementComplete&&i.statementDate===date))return state;
 if(selected.some(i=>i.statementComplete||!i.statementChecked))fail('Only selected, open invoices can be closed. Reverse a completed invoice before changing its statement date.',409);
 const batchId=randomUUID();
 return {...state,repairs:state.repairs.map(repair=>{
   if(!(repair.invoices||[]).some(i=>keys.has(`${repair.id}:${i.id}`)))return repair;
   return {...repair,revision:version(repair)+1,updatedAt:now,invoices:repair.invoices.map(invoice=>keys.has(`${repair.id}:${invoice.id}`)?{
     ...invoice,statementChecked:false,statementComplete:true,statementDate:date,statementBatchId:batchId,statementCompletedAt:now,statementCompletedBy:actor,
     statementHistory:[...(invoice.statementHistory||[]),{action:'closed',at:now,by:actor,statementDate:date,batchId}],
   }:invoice)};
 })};
}
const accountingFields=['statementChecked','statementComplete','statementDate','statementBatchId','statementCompletedAt','statementCompletedBy','statementHistory','paid','paidAt','paymentBatchId'];
function comparable(invoice) {
 const file=invoice.invoiceFile;
 const vendor=String(invoice.vendor||'').trim();
 const canonicalVendor=['federated','federated auto'].includes(vendor.toLowerCase())?'Federated Auto':vendor;
 return JSON.stringify([canonicalVendor,String(invoice.invoiceNumber||'').trim(),String(invoice.partDescription||'').trim(),Number(invoice.cost||0),
   file?[file.storagePath||'',file.bucket||'',file.name||'',file.contentType||'']:null]);
}
function preserveInvoiceHistory(incoming,existing) {
 const originals=new Map((existing?.invoices||[]).map(i=>[i.id,i]));
 const ids=new Set();
 for(const invoice of incoming.invoices||[]) {if(ids.has(invoice.id))fail('Duplicate invoice identifiers are not allowed.');ids.add(invoice.id);}
 for(const invoice of originals.values())if((invoice.statementComplete||invoice.statementHistory?.length)&&!ids.has(invoice.id))fail('Invoices with completed verification or statement history must be retained. Correct the invoice instead of removing it.',409);
 return {...incoming,invoices:(incoming.invoices||[]).map(invoice=>{
   const original=originals.get(invoice.id);
   if(original?.statementComplete) {
     if(comparable(original)!==comparable(invoice)||invoice.fileData)fail('Reverse a completed invoice before changing its details or attachment.',409);
     return original;
   }
   const result={...original,...invoice};
   for(const field of accountingFields) {
     if(original&&Object.hasOwn(original,field))result[field]=original[field];
     else delete result[field];
   }
   if(!original)Object.assign(result,{statementChecked:false,statementComplete:false,paid:false});
   return result;
 })};
}
function correctionService({db,stateRef,logChange}) {
 const accounts=db.collection('drivewiseCustomerAccounts'),works=db.collection('drivewiseMechanicWork');
 async function mutate(transform,actor,action) {
   return db.runTransaction(async tx=>{
     const ref=stateRef(),snapshot=await tx.get(ref),state=snapshot.data()?.state;
     if(!state)fail('DriveWise records are unavailable.',503);
     const next=transform(state);logChange(next,actor,action,action);
     tx.set(ref,{state:next,updatedAt:new Date()},{merge:true});
   });
 }
 return {
   createSupply:async(repair,actor)=>mutate(state=>{
     if(state.repairs.some(r=>r.id===repair.id))fail('This supply record already exists. Refresh before editing.',409);
     return {...state,repairs:[repair,...state.repairs]};
   },actor,'Add shop supply record'),
   updateSelection:async(repairId,invoiceId,updates,actor)=>mutate(state=>{
     const repair=state.repairs.find(r=>r.id===repairId),invoice=repair?.invoices?.find(i=>i.id===invoiceId);
     if(!invoice)fail('Invoice not found.',404);
     if(invoice.statementComplete)fail('Reverse the completed invoice using both confirmations before changing it.',409);
     return {...state,repairs:state.repairs.map(r=>r.id===repairId?{...r,invoices:r.invoices.map(i=>i.id===invoiceId?{...i,
       ...(updates.statementChecked!==undefined?{statementChecked:updates.statementChecked===true}:{}),
       ...(updates.paid!==undefined?{paid:updates.paid===true,paidAt:updates.paid?new Date().toISOString():i.paidAt||''}:{})}:i)}:r)};
   },actor,'Update invoice status'),
   attach:async(repairId,invoiceId,file,actor)=>mutate(state=>{
     const repair=state.repairs.find(r=>r.id===repairId),invoice=repair?.invoices?.find(i=>i.id===invoiceId);
     if(!invoice)fail('Invoice not found.',404);
     if(invoice.statementComplete)fail('Reverse the completed invoice before replacing its attachment.',409);
     return {...state,repairs:state.repairs.map(r=>r.id===repairId?{...r,revision:version(r)+1,invoices:r.invoices.map(i=>i.id===invoiceId?{...i,invoiceFile:file,
       statementHistory:[...(i.statementHistory||[]),{action:'attachment-updated',at:new Date().toISOString(),by:actor,previousFile:i.invoiceFile||null}]}:i)}:r)};
   },actor,'Update invoice attachment'),
   reopen:async(id,input,actor)=>mutate(state=>{
     const repair=state.repairs.find(r=>r.id===id);if(!repair)fail('Repair not found.',404);
     return {...state,repairs:state.repairs.map(r=>r.id===id?reopenRepair(r,input,actor):r)};
   },actor,'Reopen repair for corrections'),
   reverse:async(repairId,invoiceId,input,actor)=>mutate(state=>{
     const repair=state.repairs.find(r=>r.id===repairId);if(!repair)fail('Repair not found.',404);
     const invoice=repair.invoices?.find(i=>i.id===invoiceId);if(!invoice)fail('Invoice not found.',404);
     const next=reverseInvoice(invoice,input,actor);
     return {...state,repairs:state.repairs.map(r=>r.id===repairId?{...r,revision:version(r)+1,invoices:r.invoices.map(i=>i.id===invoiceId?next:i)}:r)};
   },actor,'Reverse invoice statement verification'),
   close:async(input,actor)=>mutate(state=>closeStatements(state,input,actor),actor,'Close invoices with vendor statement date'),
   async saveExisting(incoming,revision,initialCharge,actor,{correctionsOnly=false}={}) {
     return db.runTransaction(async tx=>{
       const ref=stateRef(),[snapshot,account,work]=await Promise.all([tx.get(ref),tx.get(accounts.doc(incoming.id)),tx.get(works.doc(incoming.id))]);
       const state=snapshot.data()?.state,existing=state?.repairs.find(r=>r.id===incoming.id);
       if(!existing)fail('This record no longer exists.',409);
       if(correctionsOnly)assertAccountingCorrection(existing,incoming);
       if(version(existing)!==Number(revision||0))fail('This record changed while you were editing. Refresh it before saving.',409);
       if(!existing.correctionOpen&&(existing.historicalComplete||account.data()?.closedAt||existing.invoices?.some(i=>i.statementComplete)))fail('Reopen this repair for corrections before editing.',409);
       const safe=preserveInvoiceHistory(incoming,existing);
       const next={...existing,...safe,revision:version(existing)+1,updatedAt:new Date().toISOString()};
       if(existing.correctionOpen) {
         next.correctionOpen=false;
         next.correctionHistory=(existing.correctionHistory||[]).map((row,index,rows)=>index===rows.length-1?{...row,finishedAt:next.updatedAt,finishedBy:actor}:row);
         if(initialCharge!==undefined&&initialCharge!==null&&String(initialCharge).trim()!=='') {
           const result=changeAccount(account.data(),{action:'charge',amount:initialCharge},actor,work.data()?.completedAt||(existing.historicalComplete?'historical-complete':''));
           tx.set(accounts.doc(incoming.id),result.account);
         }
       }
       state.repairs=state.repairs.map(r=>r.id===incoming.id?next:r);
       logChange(state,actor,existing.correctionOpen?'Save repair corrections':'Update DriveWise record',`${actor} saved ${incoming.ownerName}.`);
       tx.set(ref,{state,updatedAt:new Date()},{merge:true});
     });
   },
 };
}
module.exports={statementDate,reopenRepair,reverseInvoice,closeStatements,preserveInvoiceHistory,correctionService};
