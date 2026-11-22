import {useState} from 'react'
export default function CorrectionDialog({target,request,onDone,onClose}) {
 const [reason,setReason]=useState(''),[firstYes,setFirstYes]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [operationId]=useState(()=>crypto.randomUUID())
 const invoice=target.kind==='invoice'
 async function confirm(e) {
  e.preventDefault();setError('')
  if(invoice&&!firstYes){setFirstYes(true);return}
  setBusy(true)
  try {
   const result=await request(invoice?'/api/drivewise-reverse-invoice':'/api/drivewise-reopen-repair',{
    repairId:target.repairId,invoiceId:target.invoiceId,reason,operationId,firstConfirmed:firstYes,secondConfirmed:invoice,
   })
   onDone(result,target);onClose()
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="mechanic-backdrop"><section className="panel mechanic-share" role="dialog" aria-modal="true" aria-label={invoice?'Reverse invoice verification':'Reopen repair for corrections'}>
  <h2>{invoice?'Reverse invoice verification':'Reopen repair for corrections'}</h2><p>{target.label}</p>
  <form onSubmit={confirm}>
   {firstYes?<><p><strong>First Yes confirmed. Confirm once more to reverse this invoice.</strong></p><p>Reason: {reason}</p><p>The prior statement date and this reason will remain attached. Vendor payment records will be retained.</p></>:<>
    <p>{invoice?'Reverse the statement verification so this invoice can be corrected and checked again. This does not undo a vendor payment.':'Reopen the repair to correct its details, add another invoice, or change the agreed charge. Completed invoices remain locked until individually reversed.'}</p>
    <label>Reason (kept in the history)<textarea required maxLength={600} value={reason} onChange={e=>setReason(e.target.value)} rows={4}/></label>
   </>}
   <div className="header-actions"><button className="primary-action" type="submit" disabled={busy||!reason.trim()}>{busy?'Saving…':invoice?(firstYes?'Yes, reverse this invoice':'Yes, continue'):'Reopen repair'}</button>
    {firstYes&&<button type="button" className="secondary-action" disabled={busy} onClick={()=>setFirstYes(false)}>Back</button>}
    <button type="button" className="secondary-action" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>{error&&<p className="error-message" role="alert">{error}</p>}
 </section></div>
}
export function InvoiceHistory({invoice}) {
 return invoice.statementHistory?.length>0&&<details className="invoice-history"><summary>Statement history ({invoice.statementHistory.length})</summary>
  {invoice.statementHistory.map((entry,index)=><article key={entry.operationId||index}><strong>{entry.action==='reversed'?'Verification reversed':entry.action==='closed'?'Statement verified':entry.action==='moved'?'Invoice moved':'Attachment updated'}</strong><p>{new Date(entry.at).toLocaleString()} · {entry.by}</p>
   {entry.statementDate&&<p>Statement date: {entry.statementDate}</p>}{entry.previous?.statementDate&&<p>Previous statement date: {entry.previous.statementDate}</p>}{entry.fromLabel&&<p>From: {entry.fromLabel}<br/>To: {entry.toLabel}</p>}{entry.reason&&<p className="repair-description">Reason: {entry.reason}</p>}
  </article>)}
 </details>
}
export function StatementCell({invoice,canAccount,onReverse,onCheck,formatDate}) {
 return <>
  {invoice.statementComplete?<><strong className="statement-date">{invoice.statementDate?formatDate(invoice.statementDate):'Date not recorded'}</strong>
   {canAccount&&<button className="text-action" type="button" onClick={onReverse}>Reverse verification</button>}</>:<input type="checkbox" aria-label={`Select invoice ${invoice.invoiceNumber||invoice.id} for statement verification`} checked={Boolean(invoice.statementChecked)} disabled={!canAccount} onChange={e=>onCheck(e.target.checked)}/>}
  <InvoiceHistory invoice={invoice}/>
 </>
}
