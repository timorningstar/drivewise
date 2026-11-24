import{diagnosticBookingClosed}from'./diagnostic-cutoff.js'
import{useEffect,useState}from'react'
import{diagnosticAvailability,dayNames}from'./diagnostic-availability'
const timeLabel=time=>new Date('2000-01-01T'+time+':00').toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})
const dateLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric'})
export default function DiagnosticAppointment({repair,repairs,settings,busy,onSave}){
 const [now,setNow]=useState(()=>new Date());
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[]);
 const choices=diagnosticAvailability(repairs,settings,repair.id,now);
 const [chosenDate,setDate]=useState(repair.diagnostic?.date||''),[chosenTime,setTime]=useState(repair.diagnostic?.time||'');
 const selected=choices.find(c=>c.date===chosenDate)||choices[0];
 const date=selected?.date||'',time=selected?.times.includes(chosenTime)?chosenTime:selected?.times[0]||'';
 const locked=repair.diagnostic&&diagnosticBookingClosed(repair.diagnostic.date,now);
 return <><p>{repair.diagnostic&&<>Current appointment: {dateLabel(repair.diagnostic.date)} at {timeLabel(repair.diagnostic.time)}. </>}Contact the customer offline, then choose an available {dayNames[settings.diagnosticDay??1]} appointment. All times are Indiana local time. One appointment per time slot.</p>
 <p>Booking closes Friday at 4:00 PM Indiana time before each diagnostic day.</p>
 {locked?<p role="status">Booking for this appointment is closed. Its date and time are locked; you can still enter diagnostic results and continue the repair.</p>:choices.length?<form onSubmit={e=>{e.preventDefault();onSave({date,time})}}><div className="field-grid"><label>Diagnostic date<select name="date" required value={date} disabled={busy} onChange={e=>{setDate(e.target.value);setTime('')}}>{choices.map(c=><option key={c.date} value={c.date}>{dateLabel(c.date)}</option>)}</select></label><label>Time<select name="time" required disabled={busy} value={time} onChange={e=>setTime(e.target.value)}>{selected.times.map(t=><option key={t} value={t}>{timeLabel(t)}</option>)}</select></label></div><button className="primary-action" disabled={busy}>Save diagnostic appointment</button></form>:<p>No available diagnostic appointments. Ask a Full Admin to review the schedule.</p>}</>
}
