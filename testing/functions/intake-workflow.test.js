const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {workflowService,message}=require('./intake-workflow');
function fixture(options={}){const rows=new Map([['appState/drivewise',{state:{repairs:[],paymentBatches:[],adminLog:[]}}]]);const clone=x=>x===undefined?undefined:structuredClone(x);let serial=Promise.resolve();const doc=path=>({path,get:async()=>({exists:rows.has(path),data:()=>clone(rows.get(path))}),set:async value=>rows.set(path,clone(value)),update:async value=>rows.set(path,{...rows.get(path),...clone(value)})});const collection=(name,where=()=>true,limit=Infinity)=>({doc:id=>doc(name+'/'+id),where:(key,op,value)=>collection(name,v=>v[key]===value,limit),limit:n=>collection(name,where,n),get:async()=>{const docs=[...rows].filter(([key,value])=>key.startsWith(name+'/')&&where(value)).slice(0,limit).map(([key])=>({...doc(key),id:key.split('/').pop(),data:()=>clone(rows.get(key)),ref:doc(key)}));return {docs,size:docs.length}}});const db={collection,runTransaction:fn=>{const task=serial.then(async()=>{let writing=false;const writes=[];const tx={get:ref=>{assert.equal(writing,false,'all Firestore reads precede writes');return ref.get()},set:(ref,value,opt)=>{writing=true;writes.push(()=>rows.set(ref.path,opt?.merge?{...rows.get(ref.path),...clone(value)}:clone(value)))},update:(ref,value)=>{writing=true;writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...clone(value)}))},create:(ref,value)=>{writing=true;if(rows.has(ref.path))throw Error('exists');writes.push(()=>rows.set(ref.path,clone(value)))}};const result=await fn(tx);writes.forEach(fn=>fn());return result});serial=task.catch(()=>{});return task}};const service=workflowService({db,stateRef:()=>doc('appState/drivewise'),workCollection:collection('drivewiseMechanicWork'),links:collection('drivewiseMechanicLinks'),...options});return {service,rows};}
const application=()=>({operationId:randomUUID(),ownerName:'Sample Customer',email:'sample@example.test',phone:'555-0100',year:'2017',make:'Example',model:'Van',classAttendance:'Foundations',neededRepairs:'Brake noise'});
test('application atomically creates pending request and one combined group notification; retry creates nothing extra',async()=>{const f=fixture(),input=application();const r=await f.service.create(input,'Staff');assert.equal(r.workflowStatus,'pending');await f.service.create(input,'Staff');assert.equal(f.rows.get('appState/drivewise').state.repairs.length,1);assert.equal(f.rows.has('drivewiseWorkflowNotifications/application-'+r.id),false);assert.deepEqual(f.rows.get('drivewiseWorkflowNotifications/pending-'+r.id).recipients,['carapp@downtownmin.org','carrepair@downtownmin.org']);});
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
 assert(f.rows.get('drivewiseCustomerAccounts/'+r.id).closedAt);assert.deepEqual(f.rows.get('drivewiseNotifications/completion-'+r.id).recipients,['carapp@downtownmin.org','carrepair@downtownmin.org']);
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


test('denial retains the request and history, cancels diagnostics and blocks the PDF; reconsideration returns to pending',async()=>{
 const f=fixture();let r=await f.service.create(application(),'Staff');r=await reviewedAndScheduled(f,r);
 r=await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'not_eligible',notes:'Internal staff reason'},'Reviewer');
 assert.equal(r.workflowStatus,'not_eligible');assert.equal(r.diagnostic,null);assert.equal(f.rows.get('appState/drivewise').state.repairs.length,1);
 await assert.rejects(f.service.pdf(r.id),{statusCode:409});assert.equal(r.eligibilityHistory.length,2);assert.equal(r.eligibilityHistory[1].previousDiagnostic.date,'2026-11-23');
 r=await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'eligible',notes:'Reconsidered by staff'},'Other reviewer');
 assert.equal(r.workflowStatus,'pending');assert.equal(r.diagnostic,null);assert.equal(r.eligibilityHistory.length,3);assert(r.workflowHistory.some(v=>v.details.includes('Internal staff reason')));
 assert.equal((await f.service.pdf(r.id)).subarray(0,5).toString(),'%PDF-');
});

test('decision email commits with review, targets requester, excludes internal notes and retries without duplicates',async()=>{
 const f=fixture();const r=await f.service.create(application(),'Staff');const input={operationId:randomUUID(),revision:r.revision,decision:'not_eligible',notes:'PRIVATE internal reason',notifyCustomer:true};
 const saved=await f.service.review(r.id,input,'Staff');await f.service.review(r.id,input,'Staff');
 const events=[...f.rows.values()].filter(v=>v.kind==='decision');assert.equal(events.length,1);assert.deepEqual(events[0].recipients,[r.email]);
 const mail=await message(events[0]);assert(mail.text.includes('unable to approve'));assert(!mail.text.includes('PRIVATE'));assert(!mail.text.includes(r.classAttendance));assert.deepEqual(mail.attachments,[]);
 assert.equal(saved.decisionEmail.decision,'not_eligible');
});

test('staff can email an already saved decision without changing eligibility; missing email never creates an email',async()=>{
 const f=fixture();let r=await f.service.create(application(),'Staff');r=await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'not_eligible',notes:'Reviewed'},'Staff');const prior=structuredClone(r.eligibility);
 const input={operationId:randomUUID(),revision:r.revision,customerMessage:'A message approved by staff.'};r=await f.service.decisionEmail(r.id,input,'Staff');await f.service.decisionEmail(r.id,input,'Staff');assert.deepEqual(r.eligibility,prior);assert.equal([...f.rows.values()].filter(v=>v.kind==='decision').length,1);
 const noEmail=await f.service.create({...application(),email:''},'Staff');await assert.rejects(f.service.review(noEmail.id,{operationId:randomUUID(),revision:noEmail.revision,decision:'not_eligible',notes:'Reviewed',notifyCustomer:true},'Staff'),/email/);
 const denied=await f.service.review(noEmail.id,{operationId:randomUUID(),revision:noEmail.revision,decision:'not_eligible',notes:'Reviewed'},'Staff');await assert.rejects(f.service.decisionEmail(denied.id,{operationId:randomUUID(),revision:denied.revision},'Staff'),/email/);
});

test('an outdated queued denial is cancelled after staff reconsiders, without sending the obsolete message',async()=>{
 let fetches=0;const f=fixture({fetcher:async()=>{fetches++;throw Error('Should not send old decision')}});let r=await f.service.create(application(),'Staff');
 r=await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'not_eligible',notes:'First decision',notifyCustomer:true},'Staff');const eventId=r.decisionEmail.eventId;
 await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'eligible',notes:'Reconsidered',notifyCustomer:false},'Staff');
 for(const [key,value] of f.rows)if(value.kind==='pending'||value.kind==='application')f.rows.set(key,{...value,sentAt:'already-sent'});
 const result=await f.service.flush();assert.equal(fetches,0);assert.equal(result.sent,0);assert.equal(f.rows.get('drivewiseWorkflowNotifications/'+eventId).deliveryStatus,'superseded-not-sent');
});


test('Setup stores three direct recipients, sends one request event, retains old queued destinations and routes completions to that same group',async()=>{
 const f=fixture();const old=await f.service.create(application(),'Staff');const settings=await f.service.config();const direct=['one@example.test','two@example.test','three@example.test'];
 await f.service.settings({...settings,carRepairRequestEmails:direct,accountingEmail:'finance@example.test',diagnosticEmail:'diagnostics@example.test',contactEmail:'contact@example.test'},'Full Admin');
 const saved=f.rows.get('drivewiseSettings/workflow');assert.equal(saved.setupVersion,3);assert.deepEqual(saved.carRepairRequestEmails,direct);assert.equal(saved.applicationEmail,undefined);
 assert.deepEqual(f.rows.get('drivewiseWorkflowNotifications/pending-'+old.id).recipients,['carapp@downtownmin.org','carrepair@downtownmin.org']);
 let r=await f.service.create(application(),'Staff');assert.deepEqual(f.rows.get('drivewiseWorkflowNotifications/pending-'+r.id).recipients,direct);assert(!f.rows.has('drivewiseWorkflowNotifications/application-'+r.id));
 r=await reviewedAndScheduled(f,r);f.rows.set('drivewiseCustomerAccounts/'+r.id,{chargeCents:0,payments:[]});await f.service.completeDiagnostic(r.id,{operationId:randomUUID(),revision:r.revision,name:'Mechanic',approxHours:'1'},'Staff');assert.deepEqual(f.rows.get('drivewiseNotifications/completion-'+r.id).recipients,direct);
 const unchanged=structuredClone(saved);await assert.rejects(f.service.settings({...settings,carRepairRequestEmails:[...direct,'four@example.test']},'Full Admin'),/three/);assert.deepEqual(f.rows.get('drivewiseSettings/workflow'),unchanged);
});

test('Setup schedule is authoritative, leaves bookings intact, and older settings forms preserve it',async()=>{
 const f=fixture();let r=await f.service.create(application(),'Staff');r=await reviewedAndScheduled(f,r);
 const old=structuredClone(r.diagnostic),settings=await f.service.config();
 await f.service.settings({...settings,diagnosticDay:3,diagnosticTimes:['14:30','14:00']},'Admin');
 assert.deepEqual(f.rows.get('appState/drivewise').state.repairs[0].diagnostic,old);
 const staleForm={...settings};delete staleForm.diagnosticDay;delete staleForm.diagnosticTimes;
 await f.service.settings(staleForm,'Admin');assert.equal((await f.service.snapshot()).diagnosticDay,3);
 await assert.rejects(f.service.schedule(r.id,{operationId:randomUUID(),revision:r.revision,date:'2026-11-23',time:'15:30'},'Staff'),/Setup/);
 await assert.rejects(f.service.schedule(r.id,{operationId:randomUUID(),revision:r.revision,date:'2026-11-25',time:'15:30'},'Staff'),/Setup/);
 r=await f.service.schedule(r.id,{operationId:randomUUID(),revision:r.revision,date:'2026-11-25',time:'14:30'},'Staff');
 assert.equal(r.diagnostic.date,'2026-11-25');assert.equal(r.diagnostic.time,'14:30');
 await f.service.digest('2026-11-25');const email=await message(f.rows.get('drivewiseWorkflowNotifications/diagnostics-2026-11-25'));assert.match(email.subject,/2026-11-25/);assert(!email.subject.includes('Monday'));
 const pending=await message(f.rows.get('drivewiseWorkflowNotifications/pending-'+r.id));assert.match(pending.text,/configured in Setup/);assert(!pending.text.includes('Monday'));
});

test('concurrent diagnostic bookings allow one winner, own reschedule is safe, denial frees the slot',async()=>{
 const f=fixture();const requests=[];
 for(let i=0;i<2;i++){let r=await f.service.create(application(),'Staff');r=await f.service.review(r.id,{operationId:randomUUID(),revision:r.revision,decision:'eligible'},'Staff');requests.push(r);}
 const input=r=>({operationId:randomUUID(),revision:r.revision,date:'2026-11-23',time:'15:30'});
 const results=await Promise.allSettled(requests.map(r=>f.service.schedule(r.id,input(r),'Staff')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
 let winner=results.find(r=>r.status==='fulfilled').value;
 winner=await f.service.schedule(winner.id,input(winner),'Staff');
 await f.service.review(winner.id,{operationId:randomUUID(),revision:winner.revision,decision:'not_eligible',notes:'Sample denial'},'Staff');
 const loser=requests.find(r=>r.id!==winner.id);const booked=await f.service.schedule(loser.id,input(loser),'Staff');assert.equal(booked.diagnostic.time,'15:30');
});
