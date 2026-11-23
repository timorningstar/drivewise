const crypto=require('node:crypto');
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const limit=4500000;
function publicRepair(repair){return {id:repair.id,date:repair.repairDate,owner:repair.ownerName,vehicle:[repair.year,repair.make,repair.model].filter(Boolean).join(' '),details:repair.neededRepairs,notes:repair.notes||'',mechanic:repair.assignedMechanic?.name||'',diagnosticNotes:repair.diagnosticNotes||'',partsOrdered:repair.partsOrdered||''};}
function fileBytes(input){
 const type=input.type,name=String(input.name||'').replaceAll('\n',' ').replaceAll('\r',' ').replaceAll('/',' ').replaceAll('\\',' ').trim().slice(0,150),data=input.data;
 if(!name||typeof data!=='string'||data.length>6000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail('Choose an image or PDF, up to 4.5 MB.');
 const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>limit)fail('Each attachment must be at most 4.5 MB.');
 const valid=type==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
 const vendor=String(input.vendor||'').trim(),invoiceNumber=String(input.invoiceNumber||'').trim();
 if(vendor.length>150||invoiceNumber.length>150)fail('Shorten the vendor or invoice number.');
 if(!valid)fail('Choose a valid JPG, PNG, WebP image or PDF.');return {bytes,type,name,vendor,invoiceNumber};
}
function createMechanicService({repo,readRepair,saveFile,signFile,removeFile,now=Date.now}){
 async function access(token){if(!/^[a-f0-9]{64}$/.test(token||''))fail('This mechanic link is invalid or expired.',410);const key=hash(token),link=await repo.link(key);if(!link||link.expiresAt<=now())fail('This mechanic link has expired. Ask DTM for a new link.',410);const work=await repo.work(link.repairId);if(work?.linkHash!==key)fail('This mechanic link has been replaced or revoked.',410);if(work?.completedAt)fail('This repair is complete. The mechanic link is now closed.',410);const repair=await readRepair(link.repairId);if(!repair||repair.recordType==='shopSupply'||repair.historicalComplete)fail('This repair is complete or no longer available.',410);return {key,link,work,repair};}
 const guard=(work,grant)=>{if(work.linkHash!==grant.key||grant.link.expiresAt<=now())fail('This mechanic link has expired or been revoked.',410);};
 async function view(token){const {link,work,repair}=await access(token);return {ok:true,repair:publicRepair(repair),expiresAt:link.expiresAt,work:{notes:work.notes||[],approxHours:work.approxHours??null,completedAt:work.completedAt||'',mechanicName:work.mechanicName||'',files:await Promise.all((work.files||[]).map(async file=>({id:file.id,name:file.name,type:file.type,vendor:file.vendor||'',invoiceNumber:file.invoiceNumber||'',url:await signFile(file,Math.min(link.expiresAt,now()+15*60000))})))}};}
 return {
  async issue(id,actor){const repair=await readRepair(id);if(!repair||repair.recordType==='shopSupply'||repair.historicalComplete)fail('Completed records cannot be shared with a mechanic.');const token=crypto.randomBytes(32).toString('hex'),key=hash(token),expiresAt=now()+30*86400000;await repo.putLink(key,{repairId:id,expiresAt,createdAt:new Date(now()).toISOString(),createdBy:actor});await repo.mutate(id,work=>({...work,linkHash:key,sharedAt:new Date(now()).toISOString()}));return {ok:true,url:'https://dtm-drivewise-test.web.app/#mechanic='+token,expiresAt};},
  async revoke(id){await repo.mutate(id,work=>({...work,linkHash:null}));return {ok:true};},
  view,
  async update(token,input){const grant=await access(token),note=String(input.note||'').trim(),name=String(input.name||'').trim();if(note.length>6000||name.length>150)fail('Shorten the repair note or mechanic name.');if(input.complete===true&&!name)fail('Enter the mechanic’s name before completing the repair.');
   const hasHours=Object.hasOwn(input,'approxHours'),hourText=String(input.approxHours??'').trim();
   if(hasHours&&hourText&&!/^\d{1,4}(\.\d{1,2})?$/.test(hourText))fail('Enter approximate hours from 0 to 9999.99, with at most two decimal places.');
   const hours=hourText?Number(hourText):null;
   if(!note&&input.complete!==true&&!hasHours)fail('Enter a repair note or approximate hours.');
   await repo.mutate(grant.link.repairId,work=>{guard(work,grant);if(work.completedAt)fail('This repair is complete. The mechanic link is now closed.',410);if((work.notes||[]).length>=250)fail('This repair has reached its update limit. Contact DTM.');return {...work,...(note?{notes:[...(work.notes||[]),{body:note,author:name||work.mechanicName||'Mechanic',at:new Date(now()).toISOString()}]}:{}),
    ...(hasHours?{approxHours:hours,...(hours!==(work.approxHours??null)?{hoursHistory:[...(work.hoursHistory||[]),{from:work.approxHours??null,to:hours,by:name||work.mechanicName||'Mechanic',at:new Date(now()).toISOString()}]}:{})}:{}),
    ...(input.complete===true&&!work.completedAt?{completedAt:new Date(now()).toISOString(),mechanicName:name}:{})};});if(input.complete===true)return {ok:true,completed:true};return view(token);},
  async upload(token,input){const grant=await access(token),file=fileBytes(input);const uploadId=input.uploadId||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/.test(uploadId))fail('Choose the attachment again.');if((grant.work.files||[]).some(f=>f.id===uploadId))return view(token);if((grant.work.files||[]).length>=24)fail('This repair has reached its attachment limit.');const stored=await saveFile(grant.link.repairId,{...file,id:uploadId});try{await repo.mutate(grant.link.repairId,work=>{guard(work,grant);if(work.completedAt)fail('This repair is complete. The mechanic link is now closed.',410);if((work.files||[]).some(f=>f.id===uploadId))return work;if((work.files||[]).length>=24)fail('This repair has reached its attachment limit.');return {...work,files:[...(work.files||[]),stored]};});}catch(e){await removeFile(stored).catch(()=>{});throw e;}return view(token);}
 };
}
module.exports={createMechanicService,fileBytes,publicRepair};
