import {useState} from 'react'

export default function DrivewiseSetup({initial,request,onData}) {
 const [emails,setEmails]=useState(()=>[...(initial.carRepairRequestEmails||[]),'','',''].slice(0,3))
 const [mechanics,setMechanics]=useState(()=>initial.mechanics.map(m=>({...m})))
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 async function save(e){
  e.preventDefault();setBusy(true);setError('');setNotice('')
  try{
   const result=await request('/api/workflow/settings',{...Object.fromEntries(new FormData(e.currentTarget)),carRepairRequestEmails:emails.map(v=>v.trim()).filter(Boolean),mechanics})
   onData(result);setNotice('Setup saved. New notifications will use these recipients.')
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function digest(e){
  e.preventDefault();const date=new FormData(e.currentTarget).get('date');setBusy(true);setError('');setNotice('')
  try{const result=await request('/api/workflow/digest',{date});setNotice(`${result.count} appointment(s); ${result.sent||0} email(s) delivered. A duplicate weekly list is not sent.`)}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="panel drivewise-setup">
  <div className="section-heading"><p className="eyebrow">Full Admin</p><h2>Setup</h2></div>
  <p>Manage notification recipients and mechanics for DriveWise.</p>
  <form onSubmit={save}>
   <fieldset><legend>Car Repair Requests</legend>
    <p>This group receives new pending repair requests and completed repair work orders. Each application generates one notification. Add up to three recipients. Enter individual addresses to manage the group here.</p>
    <div className="field-grid">{emails.map((value,i)=><label key={i}>Email address {i+1}{i?' (optional)':''}<input type="email" required={i===0} maxLength={254} disabled={busy} value={value} onChange={e=>setEmails(emails.map((v,n)=>n===i?e.target.value:v))}/></label>)}</div>
   </fieldset>
   <fieldset><legend>Other email functions</legend><div className="field-grid">
    {[
     ['accountingEmail','Accounting notifications','Receives customer payment and reversal notices.'],
     ['diagnosticEmail','Friday diagnostic appointments','Receives the Monday appointment list and diagnostic PDF.'],
     ['contactEmail','DriveWise contact / replies','Contact address included in customer messages.']
    ].map(([key,label,help])=><label key={key}>{label}<input name={key} type="email" required maxLength={254} disabled={busy} defaultValue={initial[key]||''}/><small>{help}</small></label>)}
   </div></fieldset>
   <fieldset><legend>Mechanics</legend>
    <p>Repair assignments are emailed directly to the selected mechanic.</p>
    {mechanics.map((mechanic,i)=><div className="field-grid" key={mechanic.id}>
     <label>Mechanic name<input value={mechanic.name} required maxLength={150} disabled={busy} onChange={e=>setMechanics(mechanics.map((m,n)=>n===i?{...m,name:e.target.value}:m))}/></label>
     <label>Mechanic email<input type="email" value={mechanic.email} required maxLength={254} disabled={busy} onChange={e=>setMechanics(mechanics.map((m,n)=>n===i?{...m,email:e.target.value}:m))}/></label>
     <label><input type="checkbox" checked={mechanic.active} disabled={busy} onChange={e=>setMechanics(mechanics.map((m,n)=>n===i?{...m,active:e.target.checked}:m))}/> Active</label>
    </div>)}
    <button type="button" disabled={busy||mechanics.length>=40} onClick={()=>setMechanics([...mechanics,{id:crypto.randomUUID(),name:'',email:'',active:true}])}>Add mechanic</button>
   </fieldset>
   <p>Changes apply to new notifications. Messages already queued retain their original recipients.</p>
   <button className="primary-action" disabled={busy}>{busy?'Saving…':'Save setup'}</button>
  </form>
  <details><summary>Diagnostic email controls</summary><p>Friday emails run at 4:00 PM Indiana time for the following Monday. Workflow emails pending at last refresh: {initial.pending||0}.</p>
   <form onSubmit={digest}><label>Monday date for diagnostic email<input name="date" type="date" required disabled={busy}/></label><button disabled={busy}>Send diagnostic list once</button></form>
  </details>
  {error&&<p className="error-message" role="alert">{error}</p>}{notice&&<p className="success-message" role="status">{notice}</p>}
 </section>
}
