const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {changeAccount,summarize,cents,notificationMessage}=require('./customer-account');
const payment=(amount,id=randomUUID())=>({action:'payment',id,amount,date:'2026-11-22',receivedFrom:'Sample Payer',reference:'Check 100'});
test('agreed charge, partial receipts and final payment use exact cents and close only with completed work',()=>{
 let a=changeAccount({}, {action:'charge',amount:'100.30'},'Staff','').account;
 a=changeAccount(a,payment('40.10'),'Staff','').account;
 assert.equal(a.balanceCents,6020);assert.equal(a.closedAt,'');
 a=changeAccount(a,payment('60.20'),'Staff','').account;
 assert.equal(a.paidCents,10030);assert.equal(a.closedAt,'');
 a=summarize(a,'2026-11-22T12:00:00Z','2026-11-22T12:01:00Z');
 assert.equal(a.closedAt,'2026-11-22T12:01:00Z');
});
test('duplicate retry is idempotent; altered replay and overpayment rejected',()=>{
 let a=changeAccount({}, {action:'charge',amount:'50'},'Staff','complete').account;
 const input=payment('20');const result=changeAccount(a,input,'Staff','complete');a=result.account;
 assert.equal(result.event.kind,'payment');
 const retry=changeAccount(a,input,'Staff','complete');assert.equal(retry.account.payments.length,1);assert.equal(retry.event,undefined);
 assert.throws(()=>changeAccount(a,{...input,amount:'21'},'Staff','complete'),/already used/);
 assert.throws(()=>changeAccount(a,payment('30.01'),'Staff','complete'),/exceeds/);
 assert.throws(()=>changeAccount(a,{action:'charge',amount:'19.99'},'Staff','complete'),/less than/);
});
test('payment reversal retains original history, reopens repair, and queues correction once',()=>{
 let a=changeAccount({}, {action:'charge',amount:'25'},'Staff','complete').account;
 const input=payment('25');a=changeAccount(a,input,'Staff','complete').account;assert.ok(a.closedAt);
 const result=changeAccount(a,{action:'void',id:input.id,reason:'Entered twice'},'Accounting','complete');
 assert.equal(result.account.closedAt,'');assert.equal(result.account.balanceCents,2500);assert.equal(result.account.payments[0].amountCents,2500);assert.ok(result.account.payments[0].voidedAt);assert.equal(result.event.kind,'payment-reversal');
 assert.equal(changeAccount(result.account,{action:'void',id:input.id,reason:'Retry'},'Accounting','complete').event,undefined);
});
test('unset charge never closes; explicit zero charge closes after work completion, charge correction reopens',()=>{
 assert.equal(summarize({},'complete').closedAt,'');
 const zero=changeAccount({}, {action:'charge',amount:'0'},'Staff','complete').account;assert.ok(zero.closedAt);
 const corrected=changeAccount(zero,{action:'charge',amount:'10'},'Staff','complete').account;assert.equal(corrected.closedAt,'');assert.equal(corrected.audit.length,2);
});
test('invalid amounts, dates and missing payer fail without mutating original ledger',()=>{
 for(const value of ['-1','1.001','1e5','NaN','Infinity','1000001',''])assert.throws(()=>cents(value));
 const original={chargeCents:10000,payments:[]};const before=structuredClone(original);
 assert.throws(()=>changeAccount(original,{...payment('10'),date:'2026-02-30'},'Staff',''));
 assert.throws(()=>changeAccount(original,{...payment('10'),receivedFrom:''},'Staff',''));
 assert.deepEqual(original,before);
});
test('notification provides completed work, payment balance and authenticated repair link without credentials',()=>{
 const repair={id:'r1',ownerName:'Sample',year:'2020',make:'Test',model:'Car',neededRepairs:'Brakes',invoices:[{vendor:'Parts',invoiceNumber:'INV-1',cost:40}]};
 const result=notificationMessage({id:'completion-r1',kind:'completion',recipients:['test@example.test'],accountSnapshot:{chargeCents:5000,payments:[]},workSnapshot:{mechanicName:'Mechanic',completedAt:'2026-11-22',notes:[{author:'Mechanic',body:'Replaced pads'}],files:[{name:'invoice.jpg',path:'PRIVATE STORAGE'}],linkHash:'PRIVATE HASH'}},repair);
 assert.match(result.text,/Replaced pads/);assert.match(result.text,/INV-1/);assert.match(result.text,/\$50.00/);assert.match(result.text,/\?repair=r1/);assert.doesNotMatch(result.text,/PRIVATE/);
});
