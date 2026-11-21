const {test}=require('node:test');const assert=require('node:assert/strict');const {hubSession}=require('./hub-access');
const grant=role=>async()=>Response.json({uid:'fixture',email:'fixture@example.test',name:'Fixture',role});
test('Hub roles grant only their operations; unknown, revoked, and unavailable fail closed',async()=>{
 assert.equal((await hubSession('fixture',['full'],grant('Executive Director'))).role,'full');
 assert.equal((await hubSession('fixture',['schedule'],grant('Repairs only'))).role,'schedule');
 await assert.rejects(hubSession('fixture',['accounting'],grant('Repairs only')),{statusCode:403});
 await assert.rejects(hubSession('fixture',['full'],grant('Accounting')),{statusCode:403});
 const both=await hubSession('fixture',['accounting'],grant('Repairs and accounting'));assert.deepEqual(both.roles,['schedule','accounting']);
 await assert.rejects(hubSession('fixture',['full'],grant('Repairs and accounting')),{statusCode:403});
 await assert.rejects(hubSession('fixture',['full'],grant('Unrecognized')),{statusCode:403});
 await assert.rejects(hubSession('fixture',['full'],async()=>new Response('',{status:401})),{statusCode:401});
 await assert.rejects(hubSession('fixture',['full'],async()=>{throw Error('Offline')}),/Offline/);
});
