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

 test('diagnostic schedule defaults, normalizes times and rejects invalid or duplicate entries',()=>{
 assert.equal(readSettings().diagnosticDay,1);assert.deepEqual(readSettings().diagnosticTimes,['15:30','15:50','16:10']);
 const result=validateSettings({...defaults,diagnosticDay:'3',diagnosticTimes:['14:30','14:00']});assert.equal(result.diagnosticDay,3);assert.deepEqual(result.diagnosticTimes,['14:00','14:30']);
 for(const patch of [{diagnosticDay:7},{diagnosticDay:''},{diagnosticTimes:[]},{diagnosticTimes:['25:00']},{diagnosticTimes:['14:00','14:00']}])assert.throws(()=>validateSettings({...defaults,...patch}));
 const older={...defaults};delete older.diagnosticDay;delete older.diagnosticTimes;
 assert.equal(validateSettings(older,result).diagnosticDay,3);assert.deepEqual(validateSettings(older,result).diagnosticTimes,['14:00','14:30']);
 });
