import{stepBadge}from'./workflow-progress'
import {useState} from 'react'

export default function EligibilityReview({repair,messages={},busy,onSave,onEmail,stepState='next'}) {
 const current=repair.eligibility?.decision||''
 const [decision,setDecision]=useState(current),[notes,setNotes]=useState(repair.eligibility?.notes||'')
 const [text,setText]=useState(messages[current]||'')
 const hasEmail=Boolean(repair.email)
 const [notify,setNotify]=useState(hasEmail)
 function choose(value){setDecision(value);setText(messages[value]||'');if(value!==current)setNotes('')}
 return <details id="workflow-step-1" className={'workflow-step step-'+stepState} open={stepState==='next'||repair.workflowStatus==='not_eligible'}>
  <summary>1. Staff eligibility review <span className="step-badge">{stepBadge(stepState)}</span></summary>
  <p>Staff makes this decision after reviewing the application. A denied request stays in the app and can be reconsidered later.</p>
  <form onSubmit={e=>{e.preventDefault();onSave({decision,notes,notifyCustomer:notify,customerMessage:text})}}>
   <label>Staff decision<select value={decision} required onChange={e=>choose(e.target.value)}>
    <option value="">Choose a decision</option><option value="eligible">Eligible — arrange diagnostics</option><option value="not_eligible" disabled={['live','complete'].includes(repair.workflowStatus)}>Not eligible</option>
   </select></label>
   <label>Internal eligibility notes (reason required if not eligible)<textarea value={notes} onChange={e=>setNotes(e.target.value)} required={decision==='not_eligible'} maxLength={3000} rows={3}/></label>
   <p>Internal notes stay with the request and are not included in the customer email.</p>
   {hasEmail?<>
    <label><input type="checkbox" checked={notify} onChange={e=>setNotify(e.target.checked)}/> Email this decision to {repair.email} when saved</label>
    <label>Message to customer<textarea value={text} onChange={e=>setText(e.target.value)} required={notify} maxLength={6000} rows={5}/></label>
    <p>The customer receives the message above and the DriveWise contact email. No diagnostic PDF or internal notes are attached.</p>
   </>:<p>No customer email address is saved, so no decision email can be sent. You can add an email under Customer and vehicle details.</p>}
   <div className="header-actions"><button className="primary-action" disabled={busy}>Save eligibility decision</button>
    {hasEmail&&current&&decision===current&&<button type="button" disabled={busy||!text.trim()} onClick={()=>onEmail({customerMessage:text})}>Email current decision</button>}
   </div>
  </form>
  {repair.eligibility&&<p>Reviewed by {repair.eligibility.reviewedBy} on {new Date(repair.eligibility.reviewedAt).toLocaleString()}.</p>}
  {repair.decisionEmail&&<p>Last decision email queued for {repair.decisionEmail.to} on {new Date(repair.decisionEmail.queuedAt).toLocaleString()}. Delivery failures retry automatically.</p>}
 </details>
}
