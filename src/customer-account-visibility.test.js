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

test('In Diagnostics counts scheduled diagnostic requests only',async()=>{
 const{repairInDiagnostics,dashboardTotals}=await import('./drivewise-dashboard.js');
 const scheduled={workflowStatus:'diagnostic_scheduled',eligibility:{decision:'eligible'}};
 assert(repairInDiagnostics(scheduled));
 for(const repair of [{workflowStatus:'pending'},{workflowStatus:'awaiting_repair'},{workflowStatus:'live'},{...scheduled,mechanic:{completedAt:'2026-11-23'}},{...scheduled,eligibility:{decision:'not_eligible'}}])assert(!repairInDiagnostics(repair));
 assert.equal(dashboardTotals([scheduled,{workflowStatus:'not_eligible'},{workflowStatus:'complete'}]).diagnostics,1);
});

test('diagnostic options only list configured weekday, skip full weeks/past times, retain own slot and release denied slots',async()=>{
 const{diagnosticAvailability:available}=await import('./diagnostic-availability.js');
 const settings={diagnosticDay:1,diagnosticTimes:['15:30','15:50','16:10']},now=new Date('2026-11-23T20:40:00Z');
 const booked={id:'other',workflowStatus:'diagnostic_scheduled',diagnostic:{date:'2026-11-23',time:'15:50'}};
 let options=available([booked],settings,'new',now);assert.equal(options[0].date,'2026-11-23');assert.deepEqual(options[0].times,['16:10']);
 for(const option of options)assert.equal(new Date(option.date+'T12:00:00Z').getUTCDay(),1);
 options=available([booked,{...booked,id:'third',diagnostic:{date:'2026-11-23',time:'16:10'}}],settings,'new',now);assert.equal(options[0].date,'2026-11-30');
 assert(available([booked],settings,'other',now)[0].times.includes('15:50'));
 assert(available([{...booked,workflowStatus:'not_eligible'}],settings,'new',now)[0].times.includes('15:50'));
 assert.equal(available([],settings,'new',new Date('2026-11-23T22:00:00Z'))[0].date,'2026-11-30');
});

test('workflow progress highlights correct next step and retains completion states',async()=>{
 const{workflowProgress:p}=await import('./workflow-progress.js');
 assert.equal(p({}).next,1);assert.equal(p({eligibility:{decision:'eligible'}}).next,2);
 const scheduled={eligibility:{decision:'eligible'},diagnostic:{date:'2026-11-30',time:'15:30'}};assert.equal(p(scheduled).next,3);
 const diagnosed={...scheduled,diagnosticNotes:'Saved'};assert.equal(p(diagnosed).next,4);assert.equal(p(diagnosed).state(3),'done');
 assert.equal(p({...diagnosed,assignedMechanic:{id:'mechanic'}}).next,0);assert.equal(p({...diagnosed,workflowStatus:'complete'}).complete,true);assert.equal(p({eligibility:{decision:'not_eligible'}}).next,0);
});
