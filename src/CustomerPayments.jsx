import {useState} from 'react'
import {customerAccountVisible,requestDenied} from './customer-account-visibility'
const dollars=cents=>cents===null||cents===undefined?'Not set':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100)
const emptyPayment=()=>({id:crypto.randomUUID(),amount:'',date:new Date().toLocaleDateString('en-CA'),receivedFrom:'',reference:''})

export default function CustomerPayments({repairs,role,request,onAccount}) {
  const choices=repairs.filter(customerAccountVisible)
  const [id,setId]=useState(choices[0]?.id||'')
  const [charge,setCharge]=useState(''),[payment,setPayment]=useState(emptyPayment)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const repair=choices.find(r=>r.id===id)||choices[0],account=repair?.customerAccount||{},denied=repair&&requestDenied(repair)
  const canReverse=['full','admin','accounting'].includes(role)
  async function save(input) {
    setBusy(true);setError('');setNotice('')
    try {
      const result=await request('/api/drivewise-customer-account',{repairId:repair.id,...input})
      onAccount(repair.id,result.account)
      if(input.action==='payment')setPayment(emptyPayment())
      if(input.action==='charge')setCharge('')
      setNotice(result.account.closedAt?'Saved. The work is complete and the customer balance is paid; this repair is closed.':input.action==='charge'?'Agreed customer charge saved.':'Saved. The payment notification is queued automatically.')
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="panel">
    <div className="section-heading"><p className="eyebrow">Payments received</p><h2>Customer payments</h2></div>
    <p>Record money received from the vehicle owner or designated payer. Vendor invoices and payments are managed separately in Vendor Invoice View.</p>
    {!choices.length?<p>No customer repair accounts are available. Denied requests without financial history are excluded. Historical repairs become available after being reopened for corrections.</p>:<>
      <label>Repair<select value={repair?.id||''} disabled={busy} onChange={e=>{setId(e.target.value);setCharge('');setPayment(emptyPayment());setError('');setNotice('')}}>
        {choices.map(r=><option key={r.id} value={r.id}>{r.repairDate} · {r.ownerName} · {[r.year,r.make,r.model].filter(Boolean).join(' ')}</option>)}
      </select></label>
      {repair&&<>
        <p><strong>Payer:</strong> {repair.payer||repair.ownerName}</p>
        <div className="field-grid"><p><strong>Agreed charge</strong><br/>{dollars(account.chargeCents)}</p><p><strong>Payments received</strong><br/>{dollars(account.paidCents??0)}</p><p><strong>Outstanding balance</strong><br/>{dollars(account.balanceCents)}</p></div>
        <p role="status">{denied?'Denied request — retained financial history only. New charges and payments are disabled.':account.closedAt?'Closed — work complete and customer balance paid.':!repair.mechanic?.completedAt?'Open — awaiting repair completion.':account.chargeCents===null||account.chargeCents===undefined?'Work complete — enter the agreed customer charge.':'Work complete — awaiting customer payment.'}</p>
        {!denied&&<><form onSubmit={e=>{e.preventDefault();save({action:'charge',amount:charge})}}>
          <label>Agreed total customer charge ($)<input type="number" min="0" max="1000000" step="0.01" required value={charge} disabled={busy} onChange={e=>setCharge(e.target.value)}/></label>
          <p>Enter the agreed charge, including labor or subsidies. Use 0.00 if nothing is owed. Increasing a paid charge reopens the repair; payments remain in the history.</p>
          <button className="secondary-action" type="submit" disabled={busy}>Save agreed charge</button>
        </form>
        <h3>Record a payment received</h3>
        <form onSubmit={e=>{e.preventDefault();save({action:'payment',...payment})}}>
          <div className="field-grid">
            <label>Amount received ($)<input type="number" min="0.01" step="0.01" required value={payment.amount} disabled={busy||!(account.balanceCents>0)} onChange={e=>setPayment({...payment,amount:e.target.value})}/></label>
            <label>Date received<input type="date" required value={payment.date} disabled={busy} onChange={e=>setPayment({...payment,date:e.target.value})}/></label>
            <label>Received from<input required maxLength={150} value={payment.receivedFrom} disabled={busy} onChange={e=>setPayment({...payment,receivedFrom:e.target.value})}/></label>
            <label>Payment reference or method<input maxLength={200} value={payment.reference} disabled={busy} placeholder="Check number, cash, or other reference" onChange={e=>setPayment({...payment,reference:e.target.value})}/></label>
          </div>
          <button className="primary-action" type="submit" disabled={busy||!(account.balanceCents>0)}>Record payment received</button>
        </form>
        </>}<h3>Payment history</h3>
        <table className="schedule-table"><thead><tr><th>Date</th><th>Received from</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>
          {(account.payments||[]).map(p=><tr key={p.id}><td>{p.date}</td><td>{p.receivedFrom}</td><td>{dollars(p.amountCents)}</td><td>{p.reference}</td><td>{p.voidedAt?<>Reversed: {p.voidReason}</>:<>Received {canReverse&&<button className="text-action" disabled={busy} type="button" onClick={()=>{const reason=window.prompt('Reason for reversing this payment (the original entry will remain in history):');if(reason?.trim())save({action:'void',id:p.id,reason})}}>Reverse payment</button>}</>}</td></tr>)}
          {!account.payments?.length&&<tr><td colSpan="5">No customer payments recorded.</td></tr>}
        </tbody></table>
      </>}
    </>}
    {error&&<p role="alert" className="error-message">{error}</p>}{notice&&<p role="status" className="success-message">{notice}</p>}
  </section>
}

export function NotificationSettings({settings,request,onSettings}) {
  const [emails,setEmails]=useState(settings?.recipients?.join('\n')||'')
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  async function save(e){e.preventDefault();setBusy(true);setError('');try{const result=await request('/api/drivewise-notification-settings',{recipients:emails});onSettings(result.recipients);setNotice('Notification recipients saved. Future repair completions and customer payments will use these addresses.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function retry(){setBusy(true);setError('');try{const result=await request('/api/drivewise-notification-retry',{});setNotice(`${result.sent} pending notification(s) delivered. Other pending messages retry automatically.`)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <section className="panel"><div className="section-heading"><p className="eyebrow">Full Admin</p><h2>DriveWise notifications</h2></div>
    <p>Completed repairs and customer payment receipts or reversals are emailed from notification@downtownmin.org. Messages include work and payment details, plus a link to the repair and invoices that requires DTM sign-in.</p>
    <form onSubmit={save}><label>Recipients (one per line, up to eight)<textarea rows={4} required value={emails} disabled={busy} onChange={e=>setEmails(e.target.value)}/></label><button className="primary-action" disabled={busy}>Save notification recipients</button></form>
    <p>Pending at last refresh: {settings?.pending||0}. Delivery failures retry automatically every 15 minutes; saved payments are retained.</p>
    <button className="secondary-action" type="button" disabled={busy} onClick={retry}>Retry pending notifications</button>
    {error&&<p role="alert" className="error-message">{error}</p>}{notice&&<p role="status" className="success-message">{notice}</p>}
  </section>
}
