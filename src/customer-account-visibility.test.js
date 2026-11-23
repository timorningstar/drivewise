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
