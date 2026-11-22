const {cents}=require('./customer-account');
const {statementDate}=require('./corrections');
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
function transferInput(input) {
 if(!/^[a-f0-9-]{36}$/.test(input.operationId||''))fail('Reopen the invoice move window and try again.');
 const reason=String(input.reason||'').trim();if(!reason||reason.length>600)fail('Enter a reason for moving or reclassifying this invoice.');
 if(!['vehicle','shopSupply'].includes(input.destination))fail('Choose a vehicle repair or shop supplies.');
 return reason;
}
function destination(state,input,source) {
 if(input.destination==='shopSupply')return {id:'shop-'+input.operationId,recordType:'shopSupply',ownerName:'Shop Supplies',repairDate:statementDate(input.date),payer:'',neededRepairs:'Shop supplies',notes:'Reclassified invoice',createdAt:new Date().toISOString(),invoices:[]};
 const target=state.repairs.find(r=>r.id===input.targetId&&r.recordType!=='shopSupply');
 if(!target)fail('Choose an existing vehicle repair.',404);if(target.id===source.id)fail('Choose a different vehicle repair.');return target;
}
const label=record=>record.recordType==='shopSupply'?'Shop supplies':`${record.ownerName} · ${[record.year,record.make,record.model].filter(Boolean).join(' ')} · ${record.repairDate}`;
function recordTransfer(state,source,target,event,invoice) {
 return {...state,repairs:[...(state.repairs.some(r=>r.id===target.id)?[]:[{...target,invoices:invoice?[invoice]:[],invoiceTransfers:[event]}]),...state.repairs.map(r=>{
   if(r.id!==source.id&&r.id!==target.id)return r;
   return {...r,revision:(r.revision||0)+1,invoiceTransfers:[...(r.invoiceTransfers||[]),event],invoices:r.id===source.id&&event.kind==='invoice'?(r.invoices||[]).filter(i=>i.id!==event.itemId):r.id===target.id&&invoice?[...(r.invoices||[]),invoice]:r.invoices||[]};
 })]};
}
function moveAccountingInvoice(state,input,actor) {
 const reason=transferInput(input);
 if(state.repairs.some(r=>r.invoiceTransfers?.some(e=>e.operationId===input.operationId)))return state;
 const source=state.repairs.find(r=>r.id===input.repairId),invoice=source?.invoices?.find(i=>i.id===input.itemId);
 if(!invoice)fail('The source invoice no longer exists. Refresh before moving it.',409);
 if(invoice.statementComplete)fail('Reverse the completed invoice verification before moving it.',409);
 const target=destination(state,input,source);
 if(target.invoices?.some(i=>i.id===invoice.id))fail('That invoice already exists on the destination.',409);
 const event={action:'moved',kind:'invoice',operationId:input.operationId,itemId:invoice.id,fromId:source.id,toId:target.id,fromLabel:label(source),toLabel:label(target),reason,by:actor,at:new Date().toISOString()};
 const moved={...invoice,statementChecked:false,statementHistory:[...(invoice.statementHistory||[]),event]};
 return recordTransfer(state,source,target,event,moved);
}
function invoiceTransferService({db,stateRef,logChange}) {
 const works=db.collection('drivewiseMechanicWork');
 return async function transfer(input,actor) {
  const reason=transferInput(input);
  return db.runTransaction(async tx=>{
   const ref=stateRef(),snapshot=await tx.get(ref),state=snapshot.data()?.state;
   if(!state)fail('DriveWise records unavailable.',503);
   if(state.repairs.some(r=>r.invoiceTransfers?.some(e=>e.operationId===input.operationId)))return;
   let next;
   if(input.kind==='invoice')next=moveAccountingInvoice(state,input,actor);
   else if(input.kind==='mechanic') {
    const source=state.repairs.find(r=>r.id===input.repairId);if(!source)fail('Source repair not found.',404);
    const target=destination(state,input,source);
    const [sourceSnapshot,targetSnapshot]=await Promise.all([tx.get(works.doc(source.id)),tx.get(works.doc(target.id))]);
    const sourceWork=sourceSnapshot.data()||{},targetWork=targetSnapshot.data()||{},file=sourceWork.files?.find(f=>f.id===input.itemId);
    if(!file)fail('The mechanic attachment no longer exists on this repair. Refresh and try again.',409);
    const event={action:'moved',kind:'mechanic',operationId:input.operationId,itemId:file.id,fromId:source.id,toId:target.id,fromLabel:label(source),toLabel:label(target),reason,by:actor,at:new Date().toISOString()};
    let invoice;
    if(input.destination==='shopSupply') {
      const vendor=String(input.vendor||file.vendor||'').trim(),invoiceNumber=String(input.invoiceNumber||file.invoiceNumber||'').trim();
      if(!vendor||vendor.length>150||!invoiceNumber||invoiceNumber.length>150)fail('Enter the vendor and invoice number for the shop-supply invoice.');
      invoice={id:file.id,vendor,invoiceNumber,cost:cents(input.amount)/100,partDescription:'Shop supplies',invoiceFile:{storagePath:file.path,bucket:file.bucket,name:file.name,contentType:file.type},statementChecked:false,statementComplete:false,paid:false,statementHistory:[event]};
    } else {
      if((targetWork.files||[]).length>=24)fail('The destination repair has reached its attachment limit.');
      if(targetWork.files?.some(f=>f.id===file.id))fail('The destination already has this attachment.',409);
      tx.set(works.doc(target.id),{...targetWork,files:[...(targetWork.files||[]),{...file,transferHistory:[...(file.transferHistory||[]),event]}],transferHistory:[...(targetWork.transferHistory||[]),event]});
    }
    tx.set(works.doc(source.id),{...sourceWork,files:sourceWork.files.filter(f=>f.id!==file.id),transferHistory:[...(sourceWork.transferHistory||[]),event]});
    next=recordTransfer(state,source,target,event,invoice);
   } else fail('Choose an invoice or mechanic attachment.');
   logChange(next,actor,'Move or reclassify invoice',reason);
   tx.set(ref,{state:next,updatedAt:new Date()},{merge:true});
  });
 };
}
module.exports={moveAccountingInvoice,invoiceTransferService};
