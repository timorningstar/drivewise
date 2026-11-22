const {test}=require('node:test');const assert=require('node:assert/strict');const {drivewiseMetrics,verifyMetricsCaller,audience}=require('./service-metrics');
test('function metrics count distinct vehicles/owners, completed repair dates and recorded hours only',()=>{
 const repairs=[{id:'r1',vehicleTrackingId:'v1',ownerName:' Pat   Doe ',repairDate:'2026-11-01'},{id:'r2',vehicleTrackingId:'v1',ownerName:'pat doe',repairDate:'2026-11-10'},{id:'old',historicalComplete:true,vehicleTrackingId:'v2',ownerName:'Other Person',repairDate:'2026-11-02'},{id:'open',vehicleTrackingId:'v3',ownerName:'Not served yet',repairDate:'2026-11-03'},{id:'supply',recordType:'shopSupply',historicalComplete:true,repairDate:'2026-11-04'},{id:'outside',historicalComplete:true,repairDate:'2025-01-01',ownerName:'Outside'}];
 const works=new Map([['r1',{completedAt:'2026-11-05',approxHours:1.25}],['r2',{completedAt:'2026-11-20',approxHours:0.75}]]);
 const result=drivewiseMetrics(repairs,works,'2026-01-01','2026-12-31');assert.equal(result.vehicles,2);assert.equal(result.persons,2);assert.equal(result.completedRepairs,3);assert.equal(result.mechanicHours,2);assert.equal(result.hoursRecorded,2);assert.equal(result.hoursMissing,1);assert.ok(!JSON.stringify(result).includes('Pat'));assert.ok(!JSON.stringify(result).includes('v1'));
 const empty=drivewiseMetrics(repairs,works,'2027-01-01','2027-12-31');assert.equal(empty.completedRepairs,0);assert.equal(empty.mechanicHours,0);assert.equal(empty.hoursMissing,0);
 assert.throws(()=>drivewiseMetrics(repairs,works,'2026-02-30','2026-12-31'));
});
test('metrics source accepts only reporting runtime Google identity and its expected audience',async()=>{
 let claims={email:'dtm-work-orders@dtm-housing.iam.gserviceaccount.com',email_verified:true};
 const verifier={verifyIdToken:async options=>{assert.equal(options.audience,audience);return {getPayload:()=>claims};}};
 assert.equal(await verifyMetricsCaller('server-token',verifier),true);claims={email:'t1@downtownmin.org',email_verified:true};assert.equal(await verifyMetricsCaller('firebase-user-token',verifier),false);assert.equal(await verifyMetricsCaller('',verifier),false);
});
