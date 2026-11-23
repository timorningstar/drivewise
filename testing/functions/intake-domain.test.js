const {test}=require('node:test');const assert=require('node:assert/strict');const d=require('./intake-domain');
test('diagnostics only Monday and three explicit Eastern slots',()=>{assert.equal(d.appointment({date:'2026-11-23',time:'15:50'}).timeZone,'America/Indiana/Indianapolis');assert.throws(()=>d.appointment({date:'2026-11-24',time:'15:50'}));assert.throws(()=>d.appointment({date:'2026-11-23',time:'16:30'}));});
test('Friday digest picks the coming Monday in Indiana time',()=>{assert.equal(d.nextMonday(new Date('2026-11-20T21:00:00Z')),'2026-11-23');assert.equal(d.nextMonday(new Date('2026-11-21T02:00:00Z')),'2026-11-23');});
test('customer intake preserves contact/class data with required validation',()=>{const x={ownerName:' Sample ',email:'SAMPLE@EXAMPLE.ORG',phone:'555-0100',year:'2018',make:'Example',model:'Car',classAttendance:'Foundations',neededRepairs:'Brakes'};assert.equal(d.fields(x).ownerName,'Sample');assert.equal(d.fields(x).email,'sample@example.org');assert.equal(d.fields(x).payer,'Sample');assert.throws(()=>d.fields({...x,neededRepairs:''}));});
test('completion hours and audit never fabricate missing hours',()=>{assert.throws(()=>d.hours(''));assert.equal(d.hours('0'),0);assert.equal(d.hours('1.25'),1.25);const before={revision:2,workflowHistory:[{action:'created'}]};const next=d.audit(before,'scheduled','Staff','Monday');assert.equal(next.revision,3);assert.equal(next.workflowHistory.length,2);assert.equal(before.workflowHistory.length,1);});

test('email is optional but a provided address must be valid',()=>{const x={ownerName:'Sample',phone:'555-0100',year:'2020',make:'Example',model:'Van',classAttendance:'Foundations',neededRepairs:'Brakes'};assert.equal(d.fields(x).email,'');assert.throws(()=>d.fields({...x,email:'invalid'}));});

test('configured diagnostic day and times replace defaults and next date follows that weekday',()=>{
 const settings={diagnosticDay:3,diagnosticTimes:['14:00','14:30']};
 assert.equal(d.appointment({date:'2026-11-25',time:'14:30'},settings).time,'14:30');
 assert.throws(()=>d.appointment({date:'2026-11-23',time:'15:30'},settings));
 assert.throws(()=>d.appointment({date:'2026-11-25',time:'15:30'},settings));
 assert.equal(d.nextDiagnosticDay(3,new Date('2026-11-20T21:00:00Z')),'2026-11-25');
 assert.equal(d.nextDiagnosticDay(5,new Date('2026-11-20T21:00:00Z')),'2026-11-27');
});
