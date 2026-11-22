import {useState} from 'react'
export default function MoveInvoiceDialog({target,repairs,request,onDone,onClose}) {
 const choices=repairs.filter(r=>r.recordType!=='shopSupply'&&r.id!==target.repairId)
 const [destination,setDestination]=useState('vehicle'),[targetId,setTargetId]=useState(choices[0]?.id||'')
 const [date,setDate]=useState(repairs.find(r=>r.id===target.repairId)?.repairDate||'')
 const [reason,setReason]=useState(''),[vendor,setVendor]=useState(target.item.vendor||''),[invoiceNumber,setInvoiceNumber]=useState(target.item.invoiceNumber||''),[amount,setAmount]=useState('')
 const [operationId]=useState(()=>crypto.randomUUID()),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function save(e){e.preventDefault();setBusy(true);setError('');try{const result=await request('/api/drivewise-move-invoice',{kind:target.kind,repairId:target.repairId,itemId:target.item.id,destination,targetId,date,reason,vendor,invoiceNumber,amount,operationId});onDone(result);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div className="mechanic-backdrop"><section className="panel mechanic-share" role="dialog" aria-modal="true" aria-label="Move or reclassify invoice"><h2>Move or reclassify invoice</h2><p>{target.item.invoiceNumber?'Invoice '+target.item.invoiceNumber:target.item.name}</p>
  <form onSubmit={save}>
   <label>Correct destination<select value={destination} disabled={busy} onChange={e=>setDestination(e.target.value)}><option value="vehicle">Another vehicle repair</option><option value="shopSupply">Shop supplies</option></select></label>
   {destination==='vehicle'?<label>Vehicle repair<select required value={targetId} disabled={busy} onChange={e=>setTargetId(e.target.value)}><option value="">Select a repair</option>{choices.map(r=><option key={r.id} value={r.id}>{r.ownerName} · {[r.year,r.make,r.model].filter(Boolean).join(' ')} · {r.repairDate}</option>)}</select></label>:<>
    <label>Invoice date<input type="date" required value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
    {target.kind==='mechanic'&&<><label>Vendor<input required maxLength={150} value={vendor} onChange={e=>setVendor(e.target.value)}/></label><label>Invoice number<input required maxLength={150} value={invoiceNumber} onChange={e=>setInvoiceNumber(e.target.value)}/></label><label>Invoice amount ($)<input type="number" required min="0" max="1000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></>}
    <p>A shop-supply invoice record will be created using this existing attachment. No file is deleted or uploaded again.</p>
   </>}
   <label>Reason (kept with the invoice)<textarea required maxLength={600} rows={3} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
   <p>The source, destination, reason and user will be recorded. Customer charges and vendor payment records stay as recorded.</p>
   <div className="header-actions"><button className="primary-action" disabled={busy||!reason.trim()} type="submit">{busy?'Moving…':'Move invoice'}</button><button className="secondary-action" type="button" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>{error&&<p className="error-message" role="alert">{error}</p>}
 </section></div>
}
