import{test}from'node:test'
import assert from'node:assert/strict'
import{customerAccountVisible}from'./customer-account-visibility.js'
test('denied requests without real financial history are excluded, including empty projected accounts',()=>{
 for(const denied of [{workflowStatus:'not_eligible'},{eligibility:{decision:'not_eligible'}}])for(const customerAccount of [undefined,{chargeCents:null,paidCents:0,payments:[]}])assert.equal(customerAccountVisible({...denied,customerAccount}),false)
 assert.equal(customerAccountVisible({workflowStatus:'pending'}),true)
})
test('real financial history remains accessible after denial; supplies and unopened historical repairs stay excluded',()=>{
 for(const customerAccount of [{chargeCents:0},{payments:[{amountCents:100}]},{audit:[{action:'Agreed charge'}]}])assert.equal(customerAccountVisible({workflowStatus:'not_eligible',customerAccount}),true)
 assert.equal(customerAccountVisible({recordType:'shopSupply'}),false)
 assert.equal(Boolean(customerAccountVisible({historicalComplete:true})),false)
})

test('all vehicle repair records exclude denied and pre-repair applications, retaining actual and historical repairs',async()=>{
 const{vehicleRepairRecord}=await import('./drivewise-dashboard.js');
 for(const workflowStatus of ['not_eligible','pending','diagnostic_scheduled','awaiting_repair'])assert.equal(vehicleRepairRecord({workflowStatus}),false);
 for(const record of [{workflowStatus:'live'},{workflowStatus:'complete'},{historicalComplete:true},{}])assert.equal(vehicleRepairRecord(record),true);
 assert.equal(vehicleRepairRecord({eligibility:{decision:'not_eligible'}}),false);
 assert.equal(vehicleRepairRecord({recordType:'shopSupply'}),false);
});

test('completed date range uses Indiana completion dates, inclusive bounds and legacy repair date fallback',async()=>{
 const{completedRepairInRange:matches,repairCompletionDate:date}=await import('./drivewise-dashboard.js');
 const r={repairDate:'2026-10-01',mechanic:{completedAt:'2026-11-24T02:00:00Z'}};
 assert.equal(date(r),'2026-11-23');assert(matches(r,{from:'2026-11-23',through:'2026-11-23'}));
 assert(!matches(r,{from:'2026-11-24'}));assert(!matches(r,{through:'2026-11-22'}));
 assert(matches({historicalComplete:true,repairDate:'2026-11-01'},{from:'2026-11-01',through:'2026-11-30'}));
 assert(matches({},{}));assert(!matches({},{from:'2026-11-01'}));assert(!matches(r,{from:'2026-11-24',through:'2026-11-01'}));
});
