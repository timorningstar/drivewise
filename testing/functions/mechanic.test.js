const {test}=require('node:test');const assert=require('node:assert/strict');const {createMechanicService,fileBytes}=require('./mechanic');
function fixture(){let clock=100000;const links=new Map(),works=new Map(),saved=[];const repairs=[{id:'r1',ownerName:'Sample Owner',year:'2020',make:'Sample',model:'Car',neededRepairs:'Repair request',payer:'PRIVATE PAYER',invoices:[{cost:500,invoiceNumber:'PRIVATE'}]},{id:'r2',ownerName:'Other Owner',neededRepairs:'Other repair'}];
 const service=createMechanicService({repo:{link:async key=>links.get(key),work:async id=>works.get(id),putLink:async(key,value)=>links.set(key,value),mutate:async(id,fn)=>{const next=fn(structuredClone(works.get(id)||{}));works.set(id,next);return next;}},readRepair:async id=>repairs.find(r=>r.id===id),saveFile:async(id,file)=>{saved.push(file);return {id:file.id,name:file.name,type:file.type,path:id+'/'+file.id,bucket:'private'};},signFile:async file=>'https://example.test/signed/'+file.id,removeFile:async()=>{},now:()=>clock});
 return {service,repairs,saved,works,setTime:value=>clock=value};}
const token=share=>share.url.split('=')[1];
test('mechanic links expose only one repair and no payment or invoice accounting fields',async()=>{const f=fixture(),share=await f.service.issue('r1','Staff'),view=await f.service.view(token(share));assert.equal(view.repair.owner,'Sample Owner');assert(!JSON.stringify(view).includes('PRIVATE'));assert(!JSON.stringify(view).includes('Other Owner'));assert.equal(share.expiresAt,100000+30*86400000);await assert.rejects(f.service.view('bad'),{statusCode:410});});
test('replacement, revocation and expiry stop old links',async()=>{const f=fixture(),first=token(await f.service.issue('r1','Staff')),second=token(await f.service.issue('r1','Staff'));await assert.rejects(f.service.view(first),{statusCode:410});await f.service.revoke('r1');await assert.rejects(f.service.view(second),{statusCode:410});const third=await f.service.issue('r1','Staff');f.setTime(third.expiresAt);await assert.rejects(f.service.update(token(third),{note:'late'}),{statusCode:410});});
test('notes and completion require mechanic name and preserve source records and payments',async()=>{const f=fixture(),before=structuredClone(f.repairs),value=token(await f.service.issue('r1','Staff'));await assert.rejects(f.service.update(value,{complete:true}),/name/);await f.service.update(value,{note:'Part replaced',name:'Sample Mechanic',paid:true,cost:1});const result=await f.service.update(value,{name:'Sample Mechanic',approxHours:'1',noPartsUsed:true,noPartsExplanation:'Adjusted the existing assembly; no replacement parts.',complete:true});assert.equal(result.completed,true);assert(f.works.get('r1').completedAt);assert.equal(f.works.get('r1').mechanicName,'Sample Mechanic');assert.equal(f.works.get('r1').notes[0].body,'Part replaced');assert.deepEqual(f.repairs,before);assert.equal(f.works.get('r1').paid,undefined);await assert.rejects(f.service.view(value),{statusCode:410});await assert.rejects(f.service.upload(value,{}),{statusCode:410});await assert.rejects(f.service.update(value,{note:'late'}),{statusCode:410});});
test('multiple attachments validate actual bytes and never change other repairs',async()=>{const f=fixture(),value=token(await f.service.issue('r1','Staff'));const pdf={name:'invoice.pdf',type:'application/pdf',data:Buffer.from('%PDF-1.7 sample').toString('base64')};await f.service.upload(value,pdf);const view=await f.service.upload(value,{...pdf,name:'second.pdf'});assert.equal(view.work.files.length,2);assert.equal(f.works.has('r2'),false);assert.throws(()=>fileBytes({...pdf,data:Buffer.from('not a pdf').toString('base64')}),/valid/);assert.throws(()=>fileBytes({...pdf,type:'text/html'}),/valid/);});

test('retrying the same attachment does not add a duplicate',async()=>{const f=fixture(),value=token(await f.service.issue('r1','Staff'));const file={name:'invoice.pdf',type:'application/pdf',data:Buffer.from('%PDF-1.7 sample').toString('base64'),uploadId:'f16ac8a1-8ab7-4e4b-a780-0aa725b93072'};await f.service.upload(value,file);const again=await f.service.upload(value,file);assert.equal(again.work.files.length,1);assert.equal(f.saved.length,1);});

test('historical complete repairs cannot be shared or accessed through a previously issued mechanic link',async()=>{const f=fixture(),value=token(await f.service.issue('r1','Staff'));f.repairs[0].historicalComplete=true;await assert.rejects(f.service.issue('r1','Staff'),/Completed/);await assert.rejects(f.service.view(value),{statusCode:410});await assert.rejects(f.service.update(value,{note:'late'}),{statusCode:410});});
test('mechanic approximate hours are saved and auditable, with unknown distinct from zero',async()=>{const f=fixture(),value=token(await f.service.issue('r1','Staff'));assert.equal((await f.service.view(value)).work.approxHours,null);await f.service.update(value,{name:'Mechanic',approxHours:'0'});assert.equal((await f.service.view(value)).work.approxHours,0);await f.service.update(value,{name:'Mechanic',approxHours:'2.25',noPartsUsed:true,noPartsExplanation:'Adjusted existing component.',complete:true});assert.equal(f.works.get('r1').approxHours,2.25);assert.equal(f.works.get('r1').hoursHistory.length,2);await assert.rejects(f.service.update(value,{approxHours:'-2'}));await assert.rejects(f.service.update(value,{approxHours:'2.555'}));});

test('mechanic projection includes assigned name, diagnostic notes and parts without unrelated private data',async()=>{
 const f=fixture();Object.assign(f.repairs[0],{assignedMechanic:{name:'Assigned Mechanic',email:'PRIVATE EMAIL'},diagnosticNotes:'Diagnostic findings',partsOrdered:'Ordered parts',classAttendance:'PRIVATE CLASS'});
 const link=await f.service.issue('r1','Staff'),view=await f.service.view(token(link));assert.equal(view.repair.mechanic,'Assigned Mechanic');assert.equal(view.repair.diagnosticNotes,'Diagnostic findings');assert.equal(view.repair.partsOrdered,'Ordered parts');assert(!JSON.stringify(view).includes('PRIVATE'));
});

test('mechanic completion requires explicit hours and invoice or explained no-parts exception; failed completion keeps link open',async()=>{
 const f=fixture(),value=token(await f.service.issue('r1','Staff'));
 const base={name:'Mechanic',complete:true};
 for(const patch of [{},{approxHours:''},{approxHours:null}])await assert.rejects(f.service.update(value,{...base,...patch,noPartsUsed:true,noPartsExplanation:'Adjustment only.'}),/hours/);
 await assert.rejects(f.service.update(value,{...base,approxHours:'1'}),/invoice/);
 await assert.rejects(f.service.update(value,{...base,approxHours:'1',noPartsUsed:true}),/Explain/);
 assert.equal((await f.service.view(value)).work.completedAt,'');
 await f.service.update(value,{...base,approxHours:'0',noPartsUsed:true,noPartsExplanation:'Inspection and adjustment; no new parts.'});
 assert.equal(f.works.get('r1').approxHours,0);assert.equal(f.works.get('r1').noPartsUsed,true);assert(f.works.get('r1').notes.some(n=>n.body.includes('Inspection and adjustment')));
});
test('repair photos do not count as vendor invoices and invoice metadata is required before completion',async()=>{
 const f=fixture(),value=token(await f.service.issue('r1','Staff'));
 const file={name:'sample.pdf',type:'application/pdf',data:Buffer.from('%PDF-1.7 sample').toString('base64')};
 await f.service.upload(value,{...file,kind:'photo'});
 const completion={name:'Mechanic',approxHours:'1.25',complete:true};
 await assert.rejects(f.service.update(value,completion),/invoice/);
 await assert.rejects(f.service.upload(value,{...file,kind:'invoice'}),/vendor and invoice number/);
 await assert.rejects(f.service.upload(value,{...file,kind:'invoice',vendor:'Sample Vendor'}),/vendor and invoice number/);
 const view=await f.service.upload(value,{...file,kind:'invoice',vendor:'Sample Vendor',invoiceNumber:'INV-123'});
 assert.equal(view.work.invoiceCount,1);assert.equal(view.work.files[1].kind,'invoice');
 await f.service.update(value,completion);assert(f.works.get('r1').completedAt);assert.equal(f.works.get('r1').noPartsUsed,false);
});
test('completion validates the latest stored invoice list and honors documented legacy invoices',async()=>{
 const f=fixture(),value=token(await f.service.issue('r1','Staff'));
 f.works.get('r1').files=[{id:'legacy',name:'invoice.pdf',vendor:'Vendor',invoiceNumber:'L1',path:'old'}];
 assert.equal((await f.service.view(value)).work.invoiceCount,1);
 // A removed or reclassified invoice cannot be replaced with a caller-provided count.
 f.works.get('r1').files=[];
 await assert.rejects(f.service.update(value,{name:'Mechanic',approxHours:'1',invoiceCount:1,files:[{kind:'invoice',vendor:'Fake',invoiceNumber:'F'}],complete:true}),/invoice/);
});
