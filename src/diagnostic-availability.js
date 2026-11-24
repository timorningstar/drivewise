import{diagnosticBookingClosed}from'./diagnostic-cutoff.js'
export const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
export function diagnosticAvailability(repairs,settings,repairId,now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`,currentTime=`${parts.hour}:${parts.minute}`;
 const booked=new Set(repairs.filter(r=>r.id!==repairId&&r.diagnostic&&!['not_eligible','cancelled'].includes(r.workflowStatus)&&r.eligibility?.decision!=='not_eligible').map(r=>r.diagnostic.date+' '+r.diagnostic.time));
 const own=repairs.find(r=>r.id===repairId)?.diagnostic;
 const day=settings.diagnosticDay??1,times=[...(settings.diagnosticTimes||['15:30','15:50','16:10'])].sort();
 const start=new Date(today+'T12:00:00Z');start.setUTCDate(start.getUTCDate()+(day-start.getUTCDay()+7)%7);
 const choices=[];
 if(own?.date<today&&new Date(own.date+'T12:00:00Z').getUTCDay()===day&&times.includes(own.time)&&!booked.has(own.date+' '+own.time))choices.push({date:own.date,times:[own.time]});
 for(let week=0;week<104;week++){
  const date=start.toISOString().slice(0,10);
  const available=diagnosticBookingClosed(date,now)?[]:times.filter(time=>!booked.has(date+' '+time)&&(date>today||time>currentTime||(own?.date===date&&own.time===time)));
  if(available.length)choices.push({date,times:available});start.setUTCDate(start.getUTCDate()+7);
 }
 return choices;
}
