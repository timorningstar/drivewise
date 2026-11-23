import{useState}from'react'
export default function DiagnosticResults({repair,busy,onSave,onComplete}){
 const finished=Boolean(repair.mechanic?.completedAt||repair.workflowStatus==='complete');
 const [completed,setCompleted]=useState(false),[hasCharge,setHasCharge]=useState((repair.customerAccount?.chargeCents||0)>0);
 return <><p>Enter the diagnostic results and parts ordered.</p>
 {!finished&&<label className="workflow-option"><input type="checkbox" checked={completed} disabled={busy} onChange={e=>setCompleted(e.target.checked)}/> Repair completed during diagnostics</label>}
 <form onSubmit={e=>{e.preventDefault();const input=Object.fromEntries(new FormData(e.currentTarget));if(completed)onComplete({...input,chargeAmount:hasCharge?input.chargeAmount:'0',note:input.notes});else onSave(input)}}>
  <label>Diagnostic notes / repair notes<textarea name="notes" required maxLength={6000} rows={4} defaultValue={repair.diagnosticNotes||''}/></label>
  <label>Parts ordered<textarea name="partsOrdered" maxLength={6000} rows={3} defaultValue={repair.partsOrdered||''}/></label>
  {completed&&<fieldset><legend>Repair completed during diagnostics</legend>
   <label>Who did the repair?<input name="name" required maxLength={150} disabled={busy}/></label>
   <label>Approximate hours worked<input name="approxHours" type="number" min="0" max="9999.99" step=".01" required disabled={busy}/></label>
   <label className="workflow-option"><input type="checkbox" checked={hasCharge} disabled={busy} onChange={e=>setHasCharge(e.target.checked)}/> There is a charge for this repair</label>
   {hasCharge?<div className="field-grid"><label>Agreed charge ($)<input name="chargeAmount" type="number" min="0.01" max="1000000" step=".01" required disabled={busy} defaultValue={repair.customerAccount?.chargeCents? (repair.customerAccount.chargeCents/100).toFixed(2):''}/></label><label>Who pays?<input name="payer" required maxLength={150} disabled={busy} defaultValue={repair.payer||repair.ownerName}/></label></div>:<p>No charge: $0.00 will be recorded. Any existing payments must be reversed before reducing their charge below the amount received.</p>}
   <p>Saving completes the repair without assigning a mechanic. Payment can be entered later in Finance.</p>
  </fieldset>}
  <button className="primary-action" disabled={busy}>{completed?'Save and complete repair':'Save diagnostic results'}</button>
 </form></>
}
