const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {customerWorkflow}=require('./customer-workflow');
function fixture() {
 const records=new Map([['appState/drivewise',{state:{repairs:[{id:'r1',ownerName:'Sample',neededRepairs:'Brakes'},{id:'historical',historicalComplete:true},{id:'supply',recordType:'shopSupply'}]}}]]);
 let serial=Promise.resolve(),failMail=true,sent=[];
 const clone=x=>x===undefined?undefined:structuredClone(x);
 function snap(path){return {id:path.split('/').pop(),exists:records.has(path),data:()=>clone(records.get(path)),ref:doc(path)};}
 function doc(path){return {path,get:async()=>snap(path),set:async value=>records.set(path,clone(value)),update:async value=>records.set(path,{...records.get(path),...clone(value)})};}
 function collection(name,filter=()=>true,count=Infinity){return {doc:id=>doc(name+'/'+id),where:(_field,_op,value)=>collection(name,row=>row.sentAt===value,count),limit:n=>collection(name,filter,n),get:async()=>{const docs=[...records].filter(([k,v])=>k.startsWith(name+'/')&&filter(v)).slice(0,count).map(([k])=>snap(k));return {docs,size:docs.length};}};}
 const db={collection,runTransaction:fn=>{const run=serial.then(async()=>{const writes=[];const tx={get:ref=>ref.get(),set:(ref,value)=>writes.push(()=>records.set(ref.path,clone(value))),update:(ref,value)=>writes.push(()=>records.set(ref.path,{...records.get(ref.path),...clone(value)})),create:(ref,value)=>{if(records.has(ref.path))throw Error('already exists');writes.push(()=>records.set(ref.path,clone(value)));}};const result=await fn(tx);writes.forEach(write=>write());return result;});serial=run.catch(()=>{});return run;}};
 const workflow=customerWorkflow({db,stateRef:()=>doc('appState/drivewise'),workCollection:collection('drivewiseMechanicWork'),fetcher:async(url,options)=>{
   if(url.startsWith('http://metadata'))return {ok:true,text:async()=>'PRIVATE TOKEN'};
   assert.match(options.headers.Authorization,/Bearer/);
   if(failMail)return {ok:false};sent.push(JSON.parse(options.body));return {ok:true};
 }});
 return {workflow,records,sent,setMail:value=>{failMail=!value;}};
}
const pay=()=>({action:'payment',id:randomUUID(),amount:'25',date:'2026-11-22',receivedFrom:'Sample',reference:'Test'});
test('completion and outbox commit once, do not touch old state, and finalize a prepaid balance',async()=>{
 const f=fixture(),source=structuredClone(f.records.get('appState/drivewise'));
 await f.workflow.mutateAccount('r1',{action:'charge',amount:'25'},'Staff');
 const input=pay();await Promise.all([f.workflow.mutateAccount('r1',input,'Staff'),f.workflow.mutateAccount('r1',input,'Staff')]);
 await f.workflow.mutateWork('r1',work=>({...work,completedAt:'complete',mechanicName:'Mechanic'}));
 await f.workflow.mutateWork('r1',work=>({...work,notes:[{body:'Later note'}]}));
 const snapshot=await f.workflow.snapshot();assert.ok(snapshot.accounts.r1.closedAt);assert.equal(snapshot.accounts.r1.payments.length,1);assert.equal(snapshot.notifications.pending,2);
 assert.deepEqual(f.records.get('appState/drivewise'),source);
 await assert.rejects(f.workflow.assertOpen('r1'),{statusCode:409});await assert.rejects(f.workflow.assertDeletable('r1'),{statusCode:409});
});
test('failed delivery is durable and retryable without losing payment or original recipient',async()=>{
 const f=fixture();await f.workflow.mutateAccount('r1',{action:'charge',amount:'25'},'Staff');await f.workflow.mutateAccount('r1',pay(),'Staff');
 assert.deepEqual(await f.workflow.flush(),{sent:0,attempted:1});
 assert.equal((await f.workflow.snapshot()).accounts.r1.paidCents,2500);
 await f.workflow.saveSettings('later@example.test','Full Admin');f.setMail(true);await f.workflow.retry();assert.equal((await f.workflow.flush()).sent,1);
 assert.deepEqual(f.sent[0].recipients,['t1@downtownmin.org']);assert.equal((await f.workflow.snapshot()).notifications.pending,0);
 assert.equal((await f.workflow.flush()).attempted,0);
});
test('historical records, supplies and unknown IDs never receive customer ledger writes',async()=>{
 const f=fixture();for(const id of ['historical','supply','unknown'])await assert.rejects(f.workflow.mutateAccount(id,{action:'charge',amount:'10'},'Staff'),{statusCode:409});
 assert.equal(Object.keys((await f.workflow.snapshot()).accounts).length,0);
 await assert.rejects(f.workflow.saveSettings(['invalid'],'Staff'),{statusCode:400});
});
test('new repair and agreed charge save together, preserve old records and reject duplicate creation',async()=>{
 const f=fixture(),before=structuredClone(f.records.get('appState/drivewise').state.repairs);
 const repair={id:'new-repair',ownerName:'Sample Owner',payer:'Sample Payer',invoices:[]};
 await f.workflow.createRepair(repair,'Staff','125.35',state=>{state.adminLog=['Created'];});
 const state=f.records.get('appState/drivewise').state;
 assert.deepEqual(state.repairs.slice(1),before);assert.deepEqual(state.repairs[0],repair);
 const snapshot=await f.workflow.snapshot();assert.equal(snapshot.accounts['new-repair'].chargeCents,12535);assert.equal(snapshot.accounts['new-repair'].balanceCents,12535);assert.equal(snapshot.notifications.pending,0);
 await assert.rejects(f.workflow.createRepair(repair,'Staff','999',()=>{}),{statusCode:409});assert.equal((await f.workflow.snapshot()).accounts['new-repair'].chargeCents,12535);
});
test('new request requires payer and rejects invalid agreed charge before writing',async()=>{
 const f=fixture(),before=structuredClone(f.records.get('appState/drivewise'));
 await assert.rejects(f.workflow.createRepair({id:'new'},'Staff','10',()=>{}),/Payer is required/);
 await assert.rejects(f.workflow.createRepair({id:'new',payer:'Sample'},'Staff','10.001',()=>{}),/valid dollar/);
 assert.deepEqual(f.records.get('appState/drivewise'),before);assert.equal(Object.keys((await f.workflow.snapshot()).accounts).length,0);
 await f.workflow.createRepair({id:'pending-charge',payer:'Sample'},'Staff','',()=>{});
 assert.equal((await f.workflow.snapshot()).accounts['pending-charge'],undefined);
});
