const TESTING=import.meta.env.VITE_DRIVEWISE_TESTING===true
import {dashboardTotals} from './drivewise-dashboard'
export default function DrivewiseHeader({data,activeView,repairScope,canRepair,canView,canLegacyAdmin,onView,onRepairs,onNewRepair,onNewSupply,onInvoices,onLogout}) {
  const totals=dashboardTotals(data.repairs||[])
  const supply=activeView==='supplyRecords'||activeView==='supplies'
  const finance=['supplyRecords','supplies','invoices','customerPayments'].includes(activeView)
  const current=(view,scope)=>activeView===view&&(!scope||repairScope===scope)
  const tab=(label,view,scope)=> <button key={label} type="button" aria-current={current(view,scope)?'page':undefined} onClick={()=>scope?onRepairs(scope):onView(view)}>{label}</button>
  return <header className="dw-dashboard-header">
    <div className="dw-mast"><div className="dw-shell dw-mast-inner">
      <div className="dw-brand"><span className="dw-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m5 9 2-5h10l2 5M4 9h16v9H4zM6 18v2m12-2v2M7 13h2m6 0h2"/></svg></span><div><strong>Downtown Ministries</strong><small>Vehicle repairs · <a href="https://dtmapp.web.app">DTM Hub</a></small></div></div>
      <div className="dw-account"><span>{data.username}</span>{data.hubSession&&data.role==='full'&&<a href="https://dtmapp.web.app" className="dw-access-link">App Access</a>}<button className="dw-back" onClick={onLogout} type="button">{data.hubSession?'Back to DTM Hub':'Log out'}</button></div>
    </div></div>
    <div className="dw-shell">
      <div className="dw-intro"><div><h1>DriveWise{TESTING?' Testing':''}</h1><p>{canView?'Submit, share, and track vehicle repairs.':data.role==='recovery'?'Recover the full-admin account without opening DriveWise records.':'Sign in to manage vehicle repairs.'}</p></div>
        {canRepair&&<button className="primary-action dw-new" type="button" onClick={supply?onNewSupply:onNewRepair}>{supply?'+ New shop supplies':TESTING?'+ New request':'+ New repair'}</button>}
      </div>
      {canView&&<>
        <div className={TESTING?"dw-stats dw-test-stats":"dw-stats"} aria-label="DriveWise summary">
          {TESTING&&<button type="button" className="dw-stat" aria-current={activeView==='workflow'?'page':undefined} onClick={()=>onView('workflow')}><small>Pending Requests</small><strong>{totals.pending}</strong></button>}
          {TESTING&&<button type="button" className="dw-stat" aria-current={activeView==='diagnostics'?'page':undefined} onClick={()=>onView('diagnostics')}><small>In Diagnostics</small><strong>{totals.diagnostics}</strong></button>}
          <button type="button" className="dw-stat" aria-current={current('repairs','open')?'page':undefined} onClick={()=>onRepairs('open')}><small>{TESTING?'Live repairs':'Open repairs'}</small><strong>{totals.open}</strong></button>
          <button type="button" className="dw-stat" aria-current={current('repairs','completed')?'page':undefined} onClick={()=>onRepairs('completed')}><small>Completed repairs</small><strong>{totals.completed}</strong></button>
          <button type="button" className="dw-stat" aria-current={activeView==='customerPayments'?'page':undefined} onClick={()=>onView('customerPayments')}><small>Customer balances due</small><strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(totals.balanceCents/100)}</strong></button>
          {!TESTING&&<button type="button" className="dw-stat" aria-current={activeView==='invoices'?'page':undefined} onClick={onInvoices}><small>Unchecked invoices</small><strong>{totals.unchecked}</strong></button>}
        </div>
        {TESTING?<>
          <nav className="dw-tabs dw-compact-nav" aria-label="DriveWise navigation">
            {tab('All vehicle records','repairs','all')}
            <button type="button" aria-current={finance?'page':undefined} onClick={onInvoices}>Finance</button>
            {data.role==='full'&&tab('Setup','setup')}
            {data.role==='full'&&canLegacyAdmin&&tab('Admin','admin')}
          </nav>
          {finance&&<nav className="dw-finance-nav" aria-label="Finance"><strong>Finance</strong>{tab('Vendor invoices','invoices')}{tab('Shop supplies','supplyRecords')}{tab('Customer payments','customerPayments')}{canRepair&&<button type="button" onClick={onNewSupply}>+ New shop supplies</button>}</nav>}
        </>:<nav className="dw-tabs" aria-label="DriveWise navigation">
          {tab('Open repairs','repairs','open')}{tab('Completed','repairs','completed')}{tab('All vehicle records','repairs','all')}{tab('Shop supplies','supplyRecords')}{tab('Vendor invoices','invoices')}{tab('Customer payments','customerPayments')}
          {data.role==='full'&&tab('Notifications','notifications')}{data.role==='full'&&canLegacyAdmin&&tab('Admin','admin')}
        </nav>}
      </>}
    </div>
  </header>
}
