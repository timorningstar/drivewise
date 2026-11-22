const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {statementDate,reopenRepair,reverseInvoice,closeStatements,preserveInvoiceHistory,correctionService}=require('./corrections');
const confirmation=reason=>({reason,firstConfirmed:true,secondConfirmed:true,operationId:randomUUID()});
const closed=()=>({id:'i1',vendor:'Vendor',invoiceNumber:'100',partDescription:'Brakes',cost:40,statementComplete:true,statementDate:'2026-11-01',statementCompletedAt:'2026-11-10',statementCompletedBy:'Prior Accounting',paid:true,paidAt:'2026-11-11',paymentBatchId:'paid-batch',invoiceFile:{storagePath:'drivewiseInvoices/r1/original.pdf',name:'original.pdf',bucket:'private',contentType:'application/pdf'}});
test('one required statement date closes every selected invoice together and preserves vendor payment state',()=>{
 const state={repairs:[{id:'r1',invoices:[{id:'i1',statementChecked:true,paid:true},{id:'other',statementChecked:false}]},{id:'r2',invoices:[{id:'i2',statementChecked:true}]}],paymentBatches:[{id:'keep'}]};
 const input={statementDate:'2026-11-20',invoices:[{repairId:'r1',invoiceId:'i1'},{repairId:'r2',invoiceId:'i2'}]};
 const next=closeStatements(state,input,'Accounting');const a=next.repairs[0].invoices[0],b=next.repairs[1].invoices[0];
 assert.equal(a.statementDate,'2026-11-20');assert.equal(b.statementDate,a.statementDate);assert.equal(a.statementBatchId,b.statementBatchId);assert.equal(a.paid,true);assert.equal(next.repairs[0].invoices[1].statementComplete,undefined);assert.deepEqual(next.paymentBatches,state.paymentBatches);assert.equal(state.repairs[0].invoices[0].statementComplete,undefined);
 assert.equal(closeStatements(next,input,'Accounting').repairs[0].invoices[0].statementHistory.length,1);
 for(const date of ['',null,'2026-02-30','11/20/2026'])assert.throws(()=>statementDate(date));
 assert.throws(()=>closeStatements(state,{...input,invoices:[{repairId:'missing',invoiceId:'i1'}]},'Accounting'),{statusCode:409});
});
test('invoice reversal requires both Yes steps and a reason, retains prior statement and actual vendor payment',()=>{
 const invoice=closed(),input=confirmation('Wrong statement');
 for(const bad of [{...input,firstConfirmed:false},{...input,secondConfirmed:false},{...input,reason:' '}])assert.throws(()=>reverseInvoice(invoice,bad,'Accounting'));
 const next=reverseInvoice(invoice,input,'Accounting','2026-11-22T12:00:00Z');assert.equal(next.statementComplete,false);assert.equal(next.statementDate,'');assert.equal(next.paid,true);assert.equal(next.paidAt,invoice.paidAt);assert.equal(next.paymentBatchId,'paid-batch');
 const audit=next.statementHistory[0];assert.equal(audit.reason,'Wrong statement');assert.equal(audit.confirmations,2);assert.equal(audit.by,'Accounting');assert.equal(audit.previous.statementDate,'2026-11-01');assert.deepEqual(audit.previous.invoiceFile,invoice.invoiceFile);
 assert.equal(reverseInvoice(next,input,'Accounting').statementHistory.length,1);
 const state={repairs:[{id:'r1',invoices:[{...next,statementChecked:true}]}]};
 const reclosed=closeStatements(state,{statementDate:'2026-11-15',invoices:[{repairId:'r1',invoiceId:'i1'}]},'Accounting');
 assert.equal(reclosed.repairs[0].invoices[0].statementHistory[0].reason,'Wrong statement');assert.equal(reclosed.repairs[0].invoices[0].statementHistory.length,2);
});
test('reopening a repair does not unlock its verified invoices; history cannot be dropped or forged by saving a form',()=>{
 const repair={id:'r1',historicalComplete:true,invoices:[closed()]};const opened=reopenRepair(repair,{reason:'Add missing invoice'},'Repair Admin');
 assert.equal(opened.correctionOpen,true);assert.equal(opened.historicalComplete,true);assert.equal(opened.correctionHistory[0].reason,'Add missing invoice');
 const extra={id:'new',vendor:'Parts',cost:20,paid:true,statementComplete:true,statementHistory:[{reason:'FORGED'}]};
 const result=preserveInvoiceHistory({invoices:[{...closed()},extra]},opened);assert.deepEqual(result.invoices[0],closed());assert.equal(result.invoices[1].paid,false);assert.equal(result.invoices[1].statementHistory,undefined);
 assert.throws(()=>preserveInvoiceHistory({invoices:[{...closed(),cost:999}]},opened),{statusCode:409});
 assert.throws(()=>preserveInvoiceHistory({invoices:[]},opened),{statusCode:409});
 const reversed=reverseInvoice(closed(),confirmation('Correction'),'Accounting');
 assert.throws(()=>preserveInvoiceHistory({invoices:[]},{invoices:[reversed]}),{statusCode:409});
 const edited=preserveInvoiceHistory({invoices:[{...reversed,cost:45,statementHistory:[],paid:false}]},{invoices:[reversed]});assert.equal(edited.invoices[0].statementHistory[0].reason,'Correction');assert.equal(edited.invoices[0].paid,true);
});
function database() {
 const initial={repairs:[{id:'r1',ownerName:'Owner',payer:'Payer',historicalComplete:true,invoices:[closed()]},{id:'other',notes:'Untouched',invoices:[]}],paymentBatches:[{id:'paid-batch',amount:40}]};
 const records=new Map([['appState/drivewise',{state:initial}],['drivewiseCustomerAccounts/r1',{chargeCents:10000,payments:[{id:'payment',amountCents:10000}],closedAt:'prior'}],['drivewiseMechanicWork/r1',{completedAt:'prior-completion'}]]);
 let sequence=Promise.resolve();
 const doc=path=>({path,get:async()=>({data:()=>structuredClone(records.get(path))})});
 const db={collection:name=>({doc:id=>doc(name+'/'+id)}),runTransaction:fn=>{const task=sequence.then(async()=>{const writes=[];const tx={get:ref=>ref.get(),set:(ref,value,options)=>writes.push(()=>records.set(ref.path,options?.merge?{...records.get(ref.path),...structuredClone(value)}:structuredClone(value)))};const result=await fn(tx);writes.forEach(write=>write());return result;});sequence=task.catch(()=>{});return task;}};
 return {records,service:correctionService({db,stateRef:()=>doc('appState/drivewise'),logChange:()=>{}})};
}
test('repair corrections atomically change agreed charge and add an invoice while preserving completed invoice, payments and history',async()=>{
 const f=database(),original=structuredClone(f.records.get('appState/drivewise').state);
 await f.service.reopen('r1',{reason:'Invoice and agreed charge correction'},'Repair Admin');
 const opened=f.records.get('appState/drivewise').state.repairs[0];
 await f.service.saveExisting({...opened,invoices:[...opened.invoices,{id:'added',vendor:'Extra',cost:20}]},opened.revision,'125.00','Repair Admin');
 const saved=f.records.get('appState/drivewise').state.repairs[0],account=f.records.get('drivewiseCustomerAccounts/r1');
 assert.equal(saved.correctionOpen,false);assert.ok(saved.correctionHistory[0].finishedAt);assert.equal(saved.correctionHistory[0].reason,'Invoice and agreed charge correction');assert.deepEqual(saved.invoices[0],closed());assert.equal(saved.invoices.length,2);assert.equal(account.chargeCents,12500);assert.equal(account.balanceCents,2500);assert.equal(account.closedAt,'');assert.equal(account.payments.length,1);
 assert.deepEqual(f.records.get('appState/drivewise').state.repairs[1],original.repairs[1]);assert.deepEqual(f.records.get('appState/drivewise').state.paymentBatches,original.paymentBatches);
});
test('stale repair form cannot overwrite a later invoice reversal and failed corrections are atomic',async()=>{
 const f=database();await f.service.reopen('r1',{reason:'Correction'},'Repair Admin');const opened=structuredClone(f.records.get('appState/drivewise').state.repairs[0]);
 await f.service.reverse('r1','i1',confirmation('Wrong date'),'Accounting');
 await assert.rejects(f.service.saveExisting(opened,opened.revision,'120','Repair Admin'),{statusCode:409});
 const current=structuredClone(f.records.get('appState/drivewise').state.repairs[0]);
 await assert.rejects(f.service.saveExisting(current,current.revision,'50','Repair Admin'),/less than/);
 assert.deepEqual(f.records.get('appState/drivewise').state.repairs[0],current);assert.equal(f.records.get('drivewiseCustomerAccounts/r1').chargeCents,10000);
});
