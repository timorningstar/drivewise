const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {workflowService,message}=require('./intake-workflow');
function fixture(){const rows=new Map([['appState/drivewise',{state:{repairs:[],paymentBatches:[],adminLog:[]}}]]);const clone=x=>x===undefined?undefined:structuredClone(x);let serial=Promise.resolve();const doc=path=>({path,get:async()=>({exists:rows.has(path),data:()=>clone(rows.get(path))}),set:async value=>rows.set(path,clone(value))});const collection=(name,where=()=>true,limit=Infinity)=>({doc:id=>doc(name+'/'+id),where:(key,op,value)=>collection(name,v=>v[key]===value,limit),limit:n=>collection(name,where,n),get:async()=>{const docs=[...rows].filter(([key,value])=>key.startsWith(name+'/')&&where(value)).slice(0,limit).map(([key])=>({...doc(key),id:key.split('/').pop(),data:()=>clone(rows.get(key)),ref:doc(key)}));return {docs,size:docs.length}}});const db={collection,runTransaction:fn=>{const task=serial.then(async()=>{let writing=false;const writes=[];const tx={get:ref=>{assert.equal(writing,false,'all Firestore reads precede writes');return ref.get()},set:(ref,value,opt)=>{writing=true;writes.push(()=>rows.set(ref.path,opt?.merge?{...rows.get(ref.path),...clone(value)}:clone(value)))},create:(ref,value)=>{writing=true;if(rows.has(ref.path))throw Error('exists');writes.push(()=>rows.set(ref.path,clone(value)))}};const result=await fn(tx);writes.forEach(fn=>fn());return result});serial=task.catch(()=>{});return task}};const service=workflowService({db,stateRef:()=>doc('appState/drivewise'),workCollection:collection('drivewiseMechanicWork'),links:collection('drivewiseMechanicLinks')});return {service,rows};}
const application=()=>({operationId:randomUUID(),ownerName:'Sample Customer',email:'sample@example.test',phone:'555-0100',year:'2017',make:'Example',model:'Van',classAttendance:'Foundations',neededRepairs:'Brake noise'});
test('application atomically creates pending request and both addressed notifications; duplicate retry creates nothing extra',async()=>{const f=fixture(),input=application();const r=await f.service.create(input,'Staff');assert.equal(r.workflowStatus,'pending');await f.service.create(input,'Staff');assert.equal(f.rows.get('appState/drivewise').state.repairs.length,1);assert.equal(f.rows.get('drivewiseWorkflowNotifications/application-'+r.id).recipients[0],'carapp@downtownmin.org');assert.equal(f.rows.get('drivewiseWorkflowNotifications/pending-'+r.id).recipients[0],'carrepair@downtownmin.org');});
async function reviewedAndScheduled(f,r){r=await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'eligible',notes:'Staff confirmed eligibility'},'Staff');return f.service.schedule(r.id,{operationId:randomUUID(),revision:r.revision,date:'2026-11-23',time:'15:50'},'Staff');}

test('pending requests cannot schedule or activate before staff eligibility review, and do not issue mechanic links',async()=>{
 const f=fixture(),r=await f.service.create(application(),'Staff');
 await assert.rejects(f.service.schedule(r.id,{operationId:randomUUID(),revision:r.revision,date:'2026-11-23',time:'15:30'},'Staff'),/eligibility/);
 await assert.rejects(f.service.activate(r.id,{operationId:randomUUID(),revision:r.revision,mechanicId:'tim-morningstar'},'Staff'),/eligibility/);
 assert.equal(f.rows.get('appState/drivewise').state.repairs[0].workflowStatus,'pending');
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('drivewiseMechanicLinks/')).length,0);
 assert.equal([...f.rows.values()].filter(v=>v.kind==='assignment').length,0);
 const email=await message(f.rows.get('drivewiseWorkflowNotifications/pending-'+r.id));
 assert.match(email.subject,/PENDING/);assert.match(email.text,/Status: PENDING/);assert.match(email.text,/Contact the customer offline/);assert.match(email.text,/application=/);assert(!email.text.includes('#mechanic='));
});

test('activation requires diagnostics and charge, permits no receipt, and commits mechanic assignment once',async()=>{
 const f=fixture();let r=await f.service.create(application(),'Staff');r=await reviewedAndScheduled(f,r);
 r=await f.service.diagnostic(r.id,{operationId:randomUUID(),revision:r.revision,notes:'Brake pads required',partsOrdered:'Pads'},'Staff');
 const input={operationId:randomUUID(),revision:r.revision,mechanicId:'tim-morningstar'};
 await assert.rejects(f.service.activate(r.id,input,'Staff'),/charge/);
 f.rows.set('drivewiseCustomerAccounts/'+r.id,{chargeCents:15000,payments:[],paidCents:0});
 const next=await f.service.activate(r.id,input,'Staff');assert.equal(next.workflowStatus,'live');
 assert.equal(f.rows.get('drivewiseCustomerAccounts/'+r.id).paidCents,0);
 const event=f.rows.get('drivewiseWorkflowNotifications/assignment-'+input.operationId);assert.equal(event.recipients[0],'tim@tjmstar.com');
 await f.service.activate(r.id,input,'Staff');assert.equal([...f.rows.keys()].filter(k=>k.startsWith('drivewiseMechanicLinks/')).length,1);
});

test('diagnostic completion commits notification and ledger closure, rejecting stale edits',async()=>{
 const f=fixture();let r=await f.service.create(application(),'Staff');r=await reviewedAndScheduled(f,r);
 f.rows.set('drivewiseCustomerAccounts/'+r.id,{chargeCents:0,payments:[]});
 const input={operationId:randomUUID(),revision:r.revision,name:'Sample Mechanic',approxHours:'0.5',note:'Fixed at diagnostics'};
 await f.service.completeDiagnostic(r.id,input,'Staff');assert.equal(f.rows.get('drivewiseMechanicWork/'+r.id).approxHours,.5);
 assert(f.rows.get('drivewiseCustomerAccounts/'+r.id).closedAt);assert.equal(f.rows.get('drivewiseNotifications/completion-'+r.id).recipients[0],'carrepair@downtownmin.org');
 await f.service.completeDiagnostic(r.id,input,'Staff');await assert.rejects(f.service.edit(r.id,{...application(),revision:1},'Staff'),{statusCode:409});
});

test('Friday digest queues one reviewed Monday list with PDF; declined requests stay out',async()=>{
 const f=fixture();const r=await f.service.create(application(),'Staff');await reviewedAndScheduled(f,r);
 await f.service.digest('2026-11-23');await f.service.digest('2026-11-23');
 const event=f.rows.get('drivewiseWorkflowNotifications/diagnostics-2026-11-23');assert.equal(event.recipients[0],'t1@downtownmin.org');assert.equal(event.repairs.length,1);
 const mail=await message(event);assert.match(mail.text,/Sample Customer/);assert.equal(Buffer.from(mail.attachments[0].contentBytes,'base64').subarray(0,5).toString(),'%PDF-');
 const other=await f.service.create(application(),'Staff');await assert.rejects(f.service.review(other.id,{operationId:randomUUID(),revision:other.revision,decision:'not_eligible'},'Staff'),/reason/);
 const declined=await f.service.review(other.id,{operationId:randomUUID(),revision:other.revision,decision:'not_eligible',notes:'Staff determination'},'Staff');assert.equal(declined.workflowStatus,'not_eligible');assert.equal(declined.eligibility.reviewedBy,'Staff');
});
