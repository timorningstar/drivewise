import{test}from'node:test'
import assert from'node:assert/strict'
import{mechanicCompletionIssues as issues}from'./mechanic-completion.js'
const base={name:'Mechanic',hours:'1',noPartsUsed:false,noPartsExplanation:'',work:{invoiceCount:0},files:[]}
test('completion checklist keeps hours mandatory and supports invoice or explained no-parts paths',()=>{
 assert(issues(base).some(i=>i.includes('invoice')))
 assert(issues({...base,hours:'',noPartsUsed:true,noPartsExplanation:'Adjustment'}).some(i=>i.includes('hours')))
 assert(issues({...base,noPartsUsed:true}).some(i=>i.includes('Explain')))
 assert.deepEqual(issues({...base,noPartsUsed:true,noPartsExplanation:'Adjustment'}),[])
 assert.deepEqual(issues({...base,hours:'0',work:{invoiceCount:1}}),[])
 assert(issues({...base,work:{invoiceCount:1},files:[{}]}).some(i=>i.includes('selected files')))
})
