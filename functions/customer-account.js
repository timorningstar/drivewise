function reject(message) {throw Object.assign(new Error(message), {statusCode:400});}
function cents(value) {
  const text=String(value ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) reject('Enter a valid dollar amount with at most two decimal places.');
  const [whole,fraction='']=text.split('.');
  const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if (amount>100000000) reject('The amount must not exceed $1,000,000.');
  return amount;
}
function summarize(account={},completedAt='',now=new Date().toISOString()) {
  const paidCents=(account.payments||[]).filter(p=>!p.voidedAt).reduce((sum,p)=>sum+p.amountCents,0);
  const chargeCents=Number.isSafeInteger(account.chargeCents)?account.chargeCents:null;
  const balanceCents=chargeCents===null?null:chargeCents-paidCents;
  return {...account,chargeCents,paidCents,balanceCents,
    closedAt:completedAt&&balanceCents!==null&&balanceCents<=0?(account.closedAt||now):''};
}
function changeAccount(current,input,actor,completedAt,now=new Date().toISOString()) {
  const account=structuredClone(current||{});
  account.payments ||= [];
  account.audit ||= [];
  let event;
  if (input.action==='charge') {
    const charge=cents(input.amount);
    if (charge<summarize(account).paidCents) reject('The agreed charge cannot be less than payments already received. Reverse an incorrect payment first.');
    if (charge===account.chargeCents) return {account:summarize(account,completedAt,now)};
    const previous=account.chargeCents??null;
    account.chargeCents=charge;
    account.audit.push({at:now,by:actor,action:'Agreed charge',previousCents:previous,amountCents:charge});
  } else if (input.action==='payment') {
    if (!/^[a-f0-9-]{36}$/.test(input.id||'')) reject('Reload the payment form and try again.');
    const amount=cents(input.amount),receivedFrom=String(input.receivedFrom||'').trim(),reference=String(input.reference||'').trim(),date=String(input.date||'');
    if (!amount) reject('Enter a payment greater than zero.');
    if (!receivedFrom||receivedFrom.length>150||reference.length>200||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) reject('Enter a valid received date, payer name and reference.');
    const duplicate=account.payments.find(p=>p.id===input.id);
    if (duplicate) {
      if (duplicate.amountCents!==amount||duplicate.receivedFrom!==receivedFrom||duplicate.date!==date||duplicate.reference!==reference) reject('This payment ID was already used. Reload before entering another payment.');
      return {account:summarize(account,completedAt,now)};
    }
    const balance=summarize(account).balanceCents;
    if (balance===null) reject('Set the agreed total charge before recording payments.');
    if (amount>balance) reject('The payment exceeds the outstanding balance.');
    if (account.payments.length>=250) reject('This repair has reached its payment-entry limit.');
    const payment={id:input.id,amountCents:amount,date,receivedFrom,reference,recordedAt:now,recordedBy:actor};
    account.payments.push(payment);
    event={id:'payment-'+input.id,kind:'payment',payment};
  } else if (input.action==='void') {
    const payment=account.payments.find(p=>p.id===input.id);
    if (!payment) reject('Payment not found.');
    if (payment.voidedAt) return {account:summarize(account,completedAt,now)};
    const reason=String(input.reason||'').trim();
    if (!reason||reason.length>300) reject('Enter a reason for reversing this payment.');
    Object.assign(payment,{voidedAt:now,voidedBy:actor,voidReason:reason});
    event={id:'void-'+payment.id,kind:'payment-reversal',payment};
  } else reject('Choose a valid customer payment action.');
  account.updatedAt=now;
  account.audit=account.audit.slice(-250);
  const result=summarize(account,completedAt,now);
  return {account:result,event:event?{...event,createdAt:now,accountSnapshot:result}:undefined};
}
function notificationMessage(event,repair) {
  const money=value=>value===null?'Not set':'$'+(value/100).toFixed(2);
  const account=summarize(event.accountSnapshot),work=event.workSnapshot||{};
  const vehicle=[repair.year,repair.make,repair.model].filter(Boolean).join(' ');
  const title=event.kind==='completion'?'repair completed':event.kind==='payment-reversal'?'customer payment reversed':'customer payment received';
  const text=[`DTM DriveWise ${title}`,`Owner: ${repair.ownerName}`,`Vehicle: ${vehicle}`,`Repair date: ${repair.repairDate}`,`Payer: ${repair.payer||'Not entered'}`,
    '',`Work requested: ${repair.neededRepairs}`,
    ...(event.kind==='completion'?[`Completed by: ${work.mechanicName||''}`,`Completed: ${work.completedAt||''}`,`Approximate mechanic hours: ${work.approxHours??'Not recorded'}`,
      ...(work.notes||[]).map(n=>`${n.author}: ${n.body}`),`Attached mechanic files: ${(work.files||[]).map(f=>f.name).join(', ')||'None'}`]:[]),
    ...((repair.invoices||[]).map(i=>`Vendor invoice: ${i.vendor} / ${i.invoiceNumber} / $${Number(i.cost||0).toFixed(2)}`)),
    '',`Agreed customer charge: ${money(account.chargeCents)}`,`Customer payments received: ${money(account.paidCents)}`,`Outstanding customer balance: ${money(account.balanceCents)}`,
    ...(event.payment?[`Payment amount: ${money(event.payment.amountCents)}`,`Received from: ${event.payment.receivedFrom}`,`Date received: ${event.payment.date}`,`Reference: ${event.payment.reference||'None'}`,
      ...(event.payment.voidedAt?[`Reversal reason: ${event.payment.voidReason}`]:[])]:[]),
    event.accountSnapshot?.closedAt?'Customer balance paid; repair closed.':'Repair remains open until work is complete and the agreed customer balance is paid.',
    '',`Open the repair, work notes and invoices (DTM sign-in required): https://drivewise.web.app/?repair=${encodeURIComponent(repair.id)}`,
    'Customer payments are separate from vendor payments. Closing the customer balance does not mark vendor invoices paid.'].join('\n');
  return {id:event.id,subject:`DTM DriveWise ${title} - ${repair.ownerName} ${vehicle}`.slice(0,200),text:text.slice(0,24000),recipients:event.recipients};
}
module.exports={cents,summarize,changeAccount,notificationMessage};
