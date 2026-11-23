const money=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100):'Not set'
export default function CustomerPaymentSummary({account,compact=false}){
 if(!account)return null
 const payments=account.payments||[],paid=payments.reduce((total,p)=>total+(p.voidedAt?0:p.amountCents||0),0),charge=account.chargeCents,balance=Number.isSafeInteger(charge)?charge-paid:null
 if(compact)return <span className="customer-payment-inline"><strong>Customer paid: {money(paid)}</strong> · Balance due: {money(balance)}</span>
 return <section className="customer-payment-summary" aria-label="Customer payment summary"><h3>Customer payment</h3><div className="field-grid"><p><strong>Agreed charge</strong><br/>{money(charge)}</p><p><strong>Customer paid</strong><br/>{money(paid)}</p><p><strong>Balance due</strong><br/>{money(balance)}</p></div>
 <p><strong>{charge===0?'No customer charge':balance===0?'Paid in full':balance>0?'Customer balance outstanding':'Agreed charge not set'}</strong></p>
 <details><summary>Customer payment history ({payments.length})</summary>{payments.length?<table className="schedule-table"><thead><tr><th>Date received</th><th>Received from</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{p.date}</td><td>{p.receivedFrom}</td><td>{money(p.amountCents)}</td><td>{p.reference||'—'}</td><td>{p.voidedAt?'Reversed: '+p.voidReason:'Received'}</td></tr>)}</tbody></table>:<p>No customer payments recorded.</p>}</details></section>
}
