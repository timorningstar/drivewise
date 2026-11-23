const {test}=require('node:test'),assert=require('node:assert/strict');
const {defaults,readSettings,validateSettings,requestEmails}=require('./notification-settings');
test('legacy application/repair destinations are combined without losing existing settings',()=>{
 const result=readSettings({applicationEmail:'a@example.test',repairEmail:'b@example.test',diagnosticEmail:'diag@example.test',mechanics:[]});
 assert.deepEqual(result.carRepairRequestEmails,['a@example.test','b@example.test']);assert.equal(result.contactEmail,'b@example.test');assert.equal(result.diagnosticEmail,'diag@example.test');assert.deepEqual(result.mechanics,[]);
});
test('Car Repair Requests accepts at most three addresses, normalizes and deduplicates',()=>{
 assert.deepEqual(requestEmails([' A@EXAMPLE.TEST ','a@example.test','b@example.test']),['a@example.test','b@example.test']);
 assert.throws(()=>requestEmails([]));assert.throws(()=>requestEmails(['bad']));assert.throws(()=>requestEmails(['a@x.test','b@x.test','c@x.test','d@x.test']));
});
test('new setup separates functions and an older open form remains compatible',()=>{
 const saved=validateSettings({...defaults,carRepairRequestEmails:['staff@example.test'],contactEmail:'reply@example.test'});
 assert.deepEqual(saved.carRepairRequestEmails,['staff@example.test']);assert.equal(saved.contactEmail,'reply@example.test');assert.equal(saved.applicationEmail,undefined);
 const older=validateSettings({applicationEmail:'old1@example.test',repairEmail:'old2@example.test',diagnosticEmail:defaults.diagnosticEmail,accountingEmail:defaults.accountingEmail,mechanics:[]});assert.deepEqual(older.carRepairRequestEmails,['old1@example.test','old2@example.test']);
});
