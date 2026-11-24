// The Friday strictly before the diagnostic date, at 4 PM Indiana time.
function diagnosticBookingClosed(date,now=new Date()){
 const cutoff=new Date(date+'T12:00:00Z');
 cutoff.setUTCDate(cutoff.getUTCDate()-((cutoff.getUTCDay()-5+7)%7||7));
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const local=parts.year+'-'+parts.month+'-'+parts.day+' '+parts.hour+':'+parts.minute;
 return local>=cutoff.toISOString().slice(0,10)+' 16:00';
}
module.exports={diagnosticBookingClosed};
