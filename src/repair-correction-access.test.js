import{test}from'node:test'
import assert from'node:assert/strict'
import{canReopenRepair,canEditRepair}from'./repair-correction-access.js'
test('Accounting can reopen and edit existing correction records without granting new repairs or supply editing',()=>{
 assert.equal(canReopenRepair('accounting'),true);assert.equal(canEditRepair('accounting',{id:'r1',correctionOpen:true}),true);
 for(const record of [{},{id:'r1'},{id:'r1',correctionOpen:false},{id:'r1',correctionOpen:'true'},{id:'s1',recordType:'shopSupply',correctionOpen:true}])assert.equal(canEditRepair('accounting',record),false);
 for(const role of ['recovery','guest',undefined]){assert.equal(canReopenRepair(role),false);assert.equal(canEditRepair(role,{id:'r1',correctionOpen:true}),false)}
 for(const role of ['full','admin','schedule'])assert.equal(canEditRepair(role,{id:'r1'}),true);
});
