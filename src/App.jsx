import { useState } from 'react'
import './App.css'

const DRIVEWISE_APP_ID = 'drivewise'
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const DRIVEWISE_TOKEN_KEY = 'drivewiseAdminToken'

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

function appUrl(path = '') {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0)
}

function repairHasCompletedStatement(repair) {
  return (repair.invoices || []).some((invoice) => invoice.statementComplete)
}

function normalizeVehiclePart(value) {
  return String(value || '').trim().toLowerCase()
}

function sameVehicleDescription(a, b) {
  return normalizeVehiclePart(a.year) === normalizeVehiclePart(b.year) &&
    normalizeVehiclePart(a.make) === normalizeVehiclePart(b.make) &&
    normalizeVehiclePart(a.model) === normalizeVehiclePart(b.model)
}

function formatRepairDate(value) {
  if (!value) return 'No repair date'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function DrivewiseAdminApp() {
  const [token, setToken] = useState('')
  const [login, setLogin] = useState({ username: '', password: '' })
  const [data, setData] = useState(null)
  const [repairForm, setRepairForm] = useState(emptyDrivewiseRepair())
  const [activeView, setActiveView] = useState('entry')
  const [filters, setFilters] = useState({ vendor: 'all', statement: 'unchecked' })
  const [repairView, setRepairView] = useState('vehicle')
  const [accountForm, setAccountForm] = useState({ username: '', password: '' })
  const [regularForm, setRegularForm] = useState({
    username: '',
    password: '',
    accessLevel: 'admin',
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const authHeaders = (activeToken = token) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${activeToken}`,
  })

  const loadDrivewiseState = async (activeToken = token) => {
    const response = await fetch(apiUrl(`/api/drivewise-state?app=${DRIVEWISE_APP_ID}`), {
      headers: authHeaders(activeToken),
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'DriveWise admin session expired.')
    }
    setData(payload)
    setAccountForm({ username: payload.mainAdminUsername || '', password: '' })
    if (payload.role === 'accounting') setActiveView('invoices')
    if (payload.role === 'recovery') setActiveView('entry')
    setError('')
  }

  const handleLogin = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const response = await fetch(apiUrl(`/api/admin-login?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(login),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Invalid admin login.')
      sessionStorage.setItem(DRIVEWISE_TOKEN_KEY, payload.token)
      setToken(payload.token)
      setLogin({ username: '', password: '' })
      await loadDrivewiseState(payload.token)
    } catch (loginError) {
      setError(loginError.message)
    }
  }

  const saveRepair = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (needsVehicleDecision) {
      setError('Choose whether this is the same vehicle or a different vehicle before saving.')
      return
    }
    try {
      const response = await fetch(apiUrl(`/api/drivewise-repair?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ repair: repairForm }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Repair could not be saved.')
      setData(payload)
      setRepairForm(emptyDrivewiseRepair())
      setMessage('DriveWise repair record saved.')
      setActiveView('entry')
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  const deleteRepair = async (id) => {
    setError('')
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/api/drivewise-delete-repair?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Repair could not be deleted.')
      setData(payload)
      setMessage('Repair record deleted.')
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const toggleInvoiceStatus = async (repairId, invoice, updates) => {
    setError('')
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/api/drivewise-invoice-status?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ repairId, invoiceId: invoice.id, updates }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Invoice status could not be updated.')
      setData(payload)
    } catch (statusError) {
      setError(statusError.message)
    }
  }

  const completeStatementInvoices = async () => {
    if (!statementInvoices.length) return
    setError('')
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/api/drivewise-complete-statement?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          invoices: statementInvoices.map((invoice) => ({
            repairId: invoice.repair.id,
            invoiceId: invoice.id,
          })),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Statement invoices could not be completed.')
      setData(payload)
      setMessage('Statement invoices marked complete.')
    } catch (completeError) {
      setError(completeError.message)
    }
  }

  const saveMainAccount = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/api/admin-main-account?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(accountForm),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Full-admin account could not be updated.')
      }
      setData(payload)
      setAccountForm({ username: payload.mainAdminUsername || '', password: '' })
      setMessage('Full-admin account updated.')
    } catch (accountError) {
      setError(accountError.message)
    }
  }

  const addRegularAdmin = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/api/admin-regular-admins?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(regularForm),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Admin account could not be added.')
      }
      setData(payload)
      setRegularForm({ username: '', password: '', accessLevel: 'admin' })
      setMessage('Admin account added.')
    } catch (regularError) {
      setError(regularError.message)
    }
  }

  const deleteRegularAdmin = async (id) => {
    setError('')
    setMessage('')
    try {
      const response = await fetch(apiUrl(`/api/admin-delete-regular-admin?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Admin account could not be deleted.')
      }
      setData(payload)
      setMessage('Admin account deleted.')
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const handleInvoiceFile = async (index, file) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Invoice files need to be JPG, PNG, or PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Invoice files must be smaller than 10 MB.')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    updateInvoice(index, {
      fileName: file.name,
      fileContentType: file.type,
      fileData: dataUrl.split(',')[1],
      filePreviewUrl: dataUrl,
    })
  }

  const handleNotesFile = async (file) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Notes files need to be JPG, PNG, or PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Notes files must be smaller than 10 MB.')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setRepairForm((current) => ({
      ...current,
      notesFileName: file.name,
      notesFileContentType: file.type,
      notesFileData: dataUrl.split(',')[1],
      notesFilePreviewUrl: dataUrl,
    }))
  }

  const handleDashboardInvoiceFile = async (invoice, file) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Invoice files need to be JPG, PNG, or PDF.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Invoice files must be smaller than 10 MB.')
      return
    }
    setError('')
    setMessage('')
    const dataUrl = await readFileAsDataUrl(file)
    try {
      const response = await fetch(apiUrl(`/api/drivewise-invoice-file?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          repairId: invoice.repair.id,
          invoiceId: invoice.id,
          fileName: file.name,
          fileContentType: file.type,
          fileData: dataUrl.split(',')[1],
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Invoice file could not be saved.')
      setData(payload)
      setMessage('Invoice file saved.')
    } catch (fileError) {
      setError(fileError.message)
    }
  }

  const addInvoice = () => {
    setRepairForm((current) => ({
      ...current,
      invoices: [...current.invoices, emptyDrivewiseInvoice()],
    }))
  }

  const updateInvoice = (index, updates) => {
    setRepairForm((current) => ({
      ...current,
      invoices: current.invoices.map((invoice, invoiceIndex) =>
        invoiceIndex === index ? { ...invoice, ...updates } : invoice,
      ),
    }))
  }

  const removeInvoice = (index) => {
    setRepairForm((current) => ({
      ...current,
      invoices: current.invoices.filter((_, invoiceIndex) => invoiceIndex !== index),
    }))
  }

  const editRepair = (repair) => {
    if (repairHasCompletedStatement(repair)) {
      viewRepair(repair)
      return
    }
    setRepairForm({
      ...repair,
      invoices: repair.invoices?.length ? repair.invoices : [emptyDrivewiseInvoice()],
    })
    setActiveView('entry')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const viewRepair = (repair) => {
    setRepairForm({
      ...repair,
      invoices: repair.invoices?.length ? repair.invoices : [emptyDrivewiseInvoice()],
    })
    setActiveView('entry')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startNewRepair = () => {
    setRepairForm(emptyDrivewiseRepair())
    setMessage('')
    setError('')
    setActiveView('entry')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const logout = () => {
    sessionStorage.removeItem(DRIVEWISE_TOKEN_KEY)
    setToken('')
    setData(null)
  }

  const repairs = data?.repairs || []
  const canManageDrivewiseRepairs = ['full', 'admin', 'schedule'].includes(data?.role)
  const canManageDrivewiseAccounting = ['full', 'admin', 'accounting'].includes(data?.role)
  const canManageMainAccount = ['full', 'recovery'].includes(data?.role)
  const canManageRegularAdmins = data?.role === 'full'
  const canViewDrivewiseRecords = data?.role !== 'recovery'
  const isRepairFormReadOnly = repairForm.id && repairHasCompletedStatement(repairForm)
  const matchingVehicleRepairs = repairs.filter((repair) =>
    repair.id !== repairForm.id &&
    repairForm.year &&
    repairForm.make &&
    repairForm.model &&
    sameVehicleDescription(repair, repairForm),
  )
  const needsVehicleDecision = !repairForm.id &&
    Boolean(matchingVehicleRepairs.length) &&
    !repairForm.vehicleTrackingId
  const matchedVehicleRepair = matchingVehicleRepairs[0]
  const invoices = repairs.flatMap((repair) =>
    (repair.invoices || []).map((invoice) => ({ ...invoice, repair })),
  )
  const vendors = [...new Set(invoices.map((invoice) => invoice.vendor).filter(Boolean))].sort()
  const vendorDatalistId = 'drivewise-vendors'
  const invoiceFileHref = (invoice) => {
    if (invoice.invoiceFile?.url) return invoice.invoiceFile.url
    if (!invoice.invoiceFile?.storagePath) return ''
    const params = new URLSearchParams({
      token,
      path: invoice.invoiceFile.storagePath,
      bucket: invoice.invoiceFile.bucket || '',
      name: invoice.invoiceFile.name || 'invoice',
    })
    return apiUrl(`/api/drivewise-invoice-download?${params.toString()}`)
  }
  const invoicePreview = (invoice) => {
    const href = invoice.filePreviewUrl || invoiceFileHref(invoice)
    const contentType = invoice.fileContentType || invoice.invoiceFile?.contentType || ''
    if (!href) return null
    if (contentType.startsWith('image/')) return { href, type: 'image' }
    if (contentType === 'application/pdf') return { href, type: 'pdf' }
    return null
  }
  const notesFileHref = (repair) => {
    if (repair.notesFile?.url) return repair.notesFile.url
    if (!repair.notesFile?.storagePath) return ''
    const params = new URLSearchParams({
      token,
      path: repair.notesFile.storagePath,
      bucket: repair.notesFile.bucket || '',
      name: repair.notesFile.name || 'notes-attachment',
    })
    return apiUrl(`/api/drivewise-invoice-download?${params.toString()}`)
  }
  const notesPreview = (repair) => {
    const href = repair.notesFilePreviewUrl || notesFileHref(repair)
    const contentType = repair.notesFileContentType || repair.notesFile?.contentType || ''
    if (!href) return null
    if (contentType.startsWith('image/')) return { href, type: 'image' }
    if (contentType === 'application/pdf') return { href, type: 'pdf' }
    return null
  }
  const openInvoices = invoices.filter((invoice) => !invoice.statementComplete)
  const filteredInvoices = invoices.filter((invoice) => {
    const vendorMatches = filters.vendor === 'all' || invoice.vendor === filters.vendor
    const statementMatches =
      filters.statement === 'all' ||
      (filters.statement === 'unchecked' && !invoice.statementComplete && !invoice.statementChecked) ||
      (filters.statement === 'checked' && invoice.statementComplete)
    return vendorMatches && statementMatches
  }).sort((a, b) =>
    Number(a.statementComplete) - Number(b.statementComplete) ||
    Number(a.statementChecked) - Number(b.statementChecked) ||
    a.vendor.localeCompare(b.vendor) ||
    a.invoiceNumber.localeCompare(b.invoiceNumber),
  )
  const statementInvoices = openInvoices
    .filter((invoice) => invoice.statementChecked)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.invoiceNumber.localeCompare(b.invoiceNumber))
  const groupedRepairs = groupRepairs(repairs, repairView)
  const adminAccountPanel = (
    <section className="panel admin-account-panel">
      <div className="section-heading">
        <p className="eyebrow">Admin account</p>
        <h2>Main Full-Admin Account</h2>
      </div>
      <form onSubmit={saveMainAccount}>
        <div className="field-grid">
          <label>
            Login name
            <input
              onChange={(event) =>
                setAccountForm((current) => ({ ...current, username: event.target.value }))
              }
              required
              value={accountForm.username}
            />
          </label>
          <label>
            New temporary password
            <input
              onChange={(event) =>
                setAccountForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="Leave blank to keep current"
              type="password"
              value={accountForm.password}
            />
          </label>
        </div>
        <button className="primary-action" type="submit">
          Save full-admin account
        </button>
      </form>

      {canManageRegularAdmins && (
        <div className="regular-admins">
          <h2>Admin Accounts</h2>
          <form className="field-grid" onSubmit={addRegularAdmin}>
            <label>
              Login
              <input
                onChange={(event) =>
                  setRegularForm((current) => ({ ...current, username: event.target.value }))
                }
                required
                value={regularForm.username}
              />
            </label>
            <label>
              Password
              <input
                onChange={(event) =>
                  setRegularForm((current) => ({ ...current, password: event.target.value }))
                }
                required
                type="password"
                value={regularForm.password}
              />
            </label>
            <label>
              Access level
              <select
                onChange={(event) =>
                  setRegularForm((current) => ({ ...current, accessLevel: event.target.value }))
                }
                value={regularForm.accessLevel}
              >
                <option value="admin">Admin - all except account setup</option>
                <option value="schedule">Repairs only</option>
                <option value="accounting">Accounting only</option>
              </select>
            </label>
            <button className="secondary-action" type="submit">Add admin</button>
          </form>
          <div className="regular-admin-list">
            {(data.regularAdmins || []).map((regularAdmin) => (
              <div className="regular-admin-row" key={regularAdmin.id}>
                <span>
                  <strong>{regularAdmin.username}</strong><br />
                  {adminRoleLabel(regularAdmin.accessLevel)}
                </span>
                <button
                  className="text-action"
                  onClick={() => deleteRegularAdmin(regularAdmin.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )

  if (!data) {
    return (
      <main>
        <header className="site-header admin-header">
          <img src={appUrl('downtown-ministries-logo.png')} alt="Downtown Ministries logo" />
          <div>
            <p className="eyebrow">DriveWise</p>
            <h1>Invoice Admin</h1>
            <p className="intro">
              Track vehicles, repairs, vendors, invoice numbers, costs,
              statement checks, and invoice files.
            </p>
          </div>
        </header>
        <section className="admin-shell single-panel">
          <form className="panel admin-login-panel" onSubmit={handleLogin}>
            <label>
              Login
              <input
                onChange={(event) =>
                  setLogin((current) => ({ ...current, username: event.target.value }))
                }
                required
                value={login.username}
              />
            </label>
            <label>
              Password
              <input
                onChange={(event) =>
                  setLogin((current) => ({ ...current, password: event.target.value }))
                }
                required
                type="password"
                value={login.password}
              />
            </label>
            <button className="primary-action" type="submit">Log in</button>
            {error && <p className="error-message">{error}</p>}
          </form>
        </section>
      </main>
    )
  }

  return (
    <main>
      <header className="site-header admin-header">
        <img src={appUrl('downtown-ministries-logo.png')} alt="Downtown Ministries logo" />
        <div>
          <p className="eyebrow">DriveWise</p>
          <h1>Invoice Dashboard</h1>
          <p className="intro">
            Signed in as {data.username}. {data.role === 'recovery'
              ? 'Recover the full-admin account without opening DriveWise records.'
              : 'Manage repair face sheets, invoice tracking, vendor statement checks, and invoice files.'}
          </p>
          <div className="header-actions">
            <button className="secondary-action" onClick={logout} type="button">Log out</button>
          </div>
          {canViewDrivewiseRecords && (
            <nav className="top-menu">
              <button
                className={activeView === 'entry' ? 'active' : ''}
                onClick={startNewRepair}
                type="button"
              >
                New Repair Record
              </button>
              <button
                className={activeView === 'repairs' ? 'active' : ''}
                onClick={() => setActiveView('repairs')}
                type="button"
              >
                Vehicle Repair Records
              </button>
              <button
                className={activeView === 'invoices' ? 'active' : ''}
                onClick={() => setActiveView('invoices')}
                type="button"
              >
                Vendor Invoice View
              </button>
            </nav>
          )}
        </div>
      </header>

      <section className="admin-shell drivewise-shell">
        {data.role === 'recovery' && canManageMainAccount && adminAccountPanel}

        {canManageDrivewiseRepairs && activeView === 'entry' && (
        <form
          className="panel admin-editor"
          onSubmit={isRepairFormReadOnly ? (event) => event.preventDefault() : saveRepair}
        >
          <div className="section-heading admin-heading-row">
            <div>
              <p className="eyebrow">Face sheet</p>
              <h2>
                {isRepairFormReadOnly
                  ? 'View Repair Record'
                  : repairForm.id ? 'Edit Repair Record' : 'New Repair Record'}
              </h2>
            </div>
            <button
              className="secondary-action"
              onClick={startNewRepair}
              type="button"
            >
              {isRepairFormReadOnly ? 'New repair record' : 'Clear form'}
            </button>
          </div>

          <div className="field-grid">
            <label>
              Repair date *
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({ ...current, repairDate: event.target.value }))
                }
                disabled={isRepairFormReadOnly}
                required
                type="date"
                value={repairForm.repairDate}
              />
            </label>
            <label>
              Owner name *
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({ ...current, ownerName: event.target.value }))
                }
                disabled={isRepairFormReadOnly}
                required
                value={repairForm.ownerName}
              />
            </label>
            <label>
              Payer
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({ ...current, payer: event.target.value }))
                }
                disabled={isRepairFormReadOnly}
                value={repairForm.payer}
              />
            </label>
            <label>
              Year *
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({
                    ...current,
                    year: event.target.value,
                    vehicleTrackingId: '',
                  }))
                }
                disabled={isRepairFormReadOnly}
                placeholder="2020"
                required
                value={repairForm.year}
              />
            </label>
            <label>
              Make *
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({
                    ...current,
                    make: event.target.value,
                    vehicleTrackingId: '',
                  }))
                }
                disabled={isRepairFormReadOnly}
                placeholder="Toyota"
                required
                value={repairForm.make}
              />
            </label>
            <label>
              Model *
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({
                    ...current,
                    model: event.target.value,
                    vehicleTrackingId: '',
                  }))
                }
                disabled={isRepairFormReadOnly}
                placeholder="Sienna"
                required
                value={repairForm.model}
              />
            </label>
          </div>

          {needsVehicleDecision && (
            <section className="vehicle-match-alert">
              <div>
                <strong>Same vehicle?</strong>
                <p>
                  A previous repair record uses {vehicleLabel(matchedVehicleRepair)} for {matchedVehicleRepair.ownerName}
                  {' '}on {formatRepairDate(matchedVehicleRepair.repairDate)}.
                </p>
              </div>
              <div className="vehicle-match-actions">
                <button
                  className="secondary-action"
                  onClick={() =>
                    setRepairForm((current) => ({
                      ...current,
                      vehicleTrackingId: matchedVehicleRepair.vehicleTrackingId || matchedVehicleRepair.id,
                    }))
                  }
                  type="button"
                >
                  Same vehicle
                </button>
                <button
                  className="secondary-action"
                  onClick={() =>
                    setRepairForm((current) => ({
                      ...current,
                      vehicleTrackingId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                    }))
                  }
                  type="button"
                >
                  Different vehicle
                </button>
              </div>
            </section>
          )}

          <label>
            Needed repairs *
            <textarea
              onChange={(event) =>
                setRepairForm((current) => ({ ...current, neededRepairs: event.target.value }))
              }
              disabled={isRepairFormReadOnly}
              required
              rows="3"
              value={repairForm.neededRepairs}
            />
          </label>
          <label>
            Notes
            <textarea
              onChange={(event) =>
                setRepairForm((current) => ({ ...current, notes: event.target.value }))
              }
              disabled={isRepairFormReadOnly}
              rows="3"
              value={repairForm.notes}
            />
          </label>
          {!isRepairFormReadOnly && (
            <label className="camera-upload-label notes-upload-label">
              Notes image or PDF
              <input
                accept="image/jpeg,image/png,application/pdf"
                capture="environment"
                className="camera-upload-input"
                onChange={(event) => handleNotesFile(event.target.files?.[0])}
                type="file"
              />
              <span className="camera-upload-button">
                {repairForm.notesFileName || repairForm.notesFile?.name
                  ? 'Replace notes file'
                  : 'Take photo or upload notes file'}
              </span>
              {(repairForm.notesFileName || repairForm.notesFile?.name) && (
                <small className="selected-file-name">
                  {repairForm.notesFileName || repairForm.notesFile?.name}
                </small>
              )}
              {notesFileHref(repairForm) && (
                <a className="file-link" href={notesFileHref(repairForm)} rel="noreferrer" target="_blank">
                  Open saved notes file
                </a>
              )}
            </label>
          )}
          {isRepairFormReadOnly && (repairForm.notesFileName || repairForm.notesFile?.name) && (
            <div className="readonly-file-row">
              <strong>Notes file</strong>
              <span>{repairForm.notesFileName || repairForm.notesFile?.name}</span>
              {notesFileHref(repairForm) && (
                <a className="file-link" href={notesFileHref(repairForm)} rel="noreferrer" target="_blank">
                  Open saved notes file
                </a>
              )}
            </div>
          )}
          {notesPreview(repairForm)?.type === 'image' && (
            <img
              alt="Notes attachment preview"
              className="receipt-preview"
              src={notesPreview(repairForm).href}
            />
          )}
          {notesPreview(repairForm)?.type === 'pdf' && (
            <iframe
              className="invoice-pdf-preview"
              src={notesPreview(repairForm).href}
              title="Notes PDF preview"
            />
          )}

          <div className="date-editor-header">
            <strong>Parts and invoices</strong>
          </div>
          <div className="drivewise-invoice-editor">
            <datalist id={vendorDatalistId}>
              {vendors.map((vendor) => <option key={vendor} value={vendor} />)}
            </datalist>
            {repairForm.invoices.map((invoice, index) => (
              <div className="drivewise-invoice-card" key={invoice.id}>
                <div className="receipt-card-header">
                  <strong>Invoice {index + 1}</strong>
                  {!isRepairFormReadOnly && (
                    <button className="text-action" onClick={() => removeInvoice(index)} type="button">
                      Remove
                    </button>
                  )}
                </div>
                <div className="field-grid">
                  <label>
                    Vendor
                    <input
                      disabled={isRepairFormReadOnly}
                      list={vendorDatalistId}
                      onChange={(event) => updateInvoice(index, { vendor: event.target.value })}
                      value={invoice.vendor}
                    />
                  </label>
                  <label>
                    Invoice #
                    <input
                      disabled={isRepairFormReadOnly}
                      onChange={(event) => updateInvoice(index, { invoiceNumber: event.target.value })}
                      value={invoice.invoiceNumber}
                    />
                  </label>
                  <label>
                    Part description
                    <input
                      disabled={isRepairFormReadOnly}
                      onChange={(event) => updateInvoice(index, { partDescription: event.target.value })}
                      value={invoice.partDescription}
                    />
                  </label>
                  <label>
                    Cost
                    <input
                      disabled={isRepairFormReadOnly}
                      onChange={(event) => updateInvoice(index, { cost: event.target.value })}
                      step="0.01"
                      type="number"
                      value={invoice.cost}
                    />
                  </label>
                  {!isRepairFormReadOnly && (
                    <label className="camera-upload-label">
                      Invoice image or PDF *
                      <input
                        accept="image/jpeg,image/png,application/pdf"
                        capture="environment"
                        className="camera-upload-input"
                        onChange={(event) => handleInvoiceFile(index, event.target.files?.[0])}
                        required={!invoice.invoiceFile && !invoice.fileData}
                        type="file"
                      />
                      <span className="camera-upload-button">
                        {invoice.fileName || invoice.invoiceFile?.name
                          ? 'Replace invoice file'
                          : 'Take photo or upload file'}
                      </span>
                      {(invoice.fileName || invoice.invoiceFile?.name) && (
                        <small className="selected-file-name">
                          {invoice.fileName || invoice.invoiceFile?.name}
                        </small>
                      )}
                      {invoiceFileHref(invoice) && (
                        <a className="file-link" href={invoiceFileHref(invoice)} rel="noreferrer" target="_blank">
                          Open saved invoice
                        </a>
                      )}
                    </label>
                  )}
                  {isRepairFormReadOnly && (invoice.fileName || invoice.invoiceFile?.name) && (
                    <div className="readonly-file-row">
                      <strong>Invoice file</strong>
                      <span>{invoice.fileName || invoice.invoiceFile?.name}</span>
                      {invoiceFileHref(invoice) && (
                        <a className="file-link" href={invoiceFileHref(invoice)} rel="noreferrer" target="_blank">
                          Open saved invoice
                        </a>
                      )}
                    </div>
                  )}
                </div>
                {invoicePreview(invoice)?.type === 'image' && (
                  <img
                    alt={`Invoice ${index + 1} preview`}
                    className="receipt-preview"
                    src={invoicePreview(invoice).href}
                  />
                )}
                {invoicePreview(invoice)?.type === 'pdf' && (
                  <iframe
                    className="invoice-pdf-preview"
                    src={invoicePreview(invoice).href}
                    title={`Invoice ${index + 1} PDF preview`}
                  />
                )}
              </div>
            ))}
          </div>
          {!isRepairFormReadOnly && (
            <div className="form-action-row">
              <button className="secondary-action" onClick={addInvoice} type="button">
                Add another invoice
              </button>
              <button className="primary-action admin-save" type="submit">Save repair record</button>
            </div>
          )}
        </form>
        )}

        {canViewDrivewiseRecords && activeView === 'invoices' && (
        <section className="panel printable-schedule">
          <div className="section-heading admin-heading-row no-print">
            <div>
              <p className="eyebrow">Invoices</p>
              <h2>Vendor Statement and Payment View</h2>
            </div>
          </div>

          <div className="schedule-filters no-print">
            <label>
              Vendor
              <select
                onChange={(event) => setFilters((current) => ({ ...current, vendor: event.target.value }))}
                value={filters.vendor}
              >
                <option value="all">All vendors</option>
                {vendors.map((vendor) => <option key={vendor}>{vendor}</option>)}
              </select>
            </label>
            <label>
              Statement
              <select
                onChange={(event) => setFilters((current) => ({ ...current, statement: event.target.value }))}
                value={filters.statement}
              >
                <option value="all">All invoices</option>
                <option value="unchecked">Unchecked</option>
                <option value="checked">Statement checked</option>
              </select>
            </label>
          </div>

          {statementInvoices.length > 0 && (
            <section className="statement-print-list">
              <div className="section-heading admin-heading-row no-print">
                <div>
                  <p className="eyebrow">Statement List</p>
                  <h2>Invoices Selected for Payment</h2>
                </div>
                <button className="secondary-action" onClick={() => window.print()} type="button">
                  Print statement list
                </button>
                <button className="secondary-action" onClick={completeStatementInvoices} type="button">
                  Mark complete
                </button>
              </div>
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Invoice #</th>
                    <th>Cost</th>
                    <th className="no-print">Statement</th>
                  </tr>
                </thead>
                <tbody>
                  {statementInvoices.map((invoice) => (
                    <tr key={`statement-${invoice.repair.id}-${invoice.id}`}>
                      <td>{invoice.vendor}</td>
                      <td>{invoice.invoiceNumber}</td>
                      <td>{formatCurrency(invoice.cost)}</td>
                      <td className="no-print">
                        <input
                          checked={invoice.statementChecked}
                          disabled={!canManageDrivewiseAccounting}
                          onChange={(event) =>
                            toggleInvoiceStatus(invoice.repair.id, invoice, { statementChecked: event.target.checked })
                          }
                          type="checkbox"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <table className="schedule-table drivewise-table no-print">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Invoice #</th>
                <th>Owner / Vehicle</th>
                <th>Part</th>
                <th>Cost</th>
                <th>Invoice</th>
                <th className="no-print">Statement</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((invoice) => (
                <tr key={`${invoice.repair.id}-${invoice.id}`}>
                  <td>{invoice.vendor}</td>
                  <td>{invoice.invoiceNumber}</td>
                  <td>{invoice.repair.ownerName}<br />{vehicleLabel(invoice.repair)}</td>
                  <td>{invoice.partDescription}</td>
                  <td>{formatCurrency(invoice.cost)}</td>
                  <td>
                    {invoiceFileHref(invoice) ? (
                      <a href={invoiceFileHref(invoice)} rel="noreferrer" target="_blank">
                        Invoice
                      </a>
                    ) : (
                      <label className="inline-upload-label">
                        Missing
                        <input
                          accept="image/jpeg,image/png,application/pdf"
                          className="camera-upload-input"
                          onChange={(event) => handleDashboardInvoiceFile(invoice, event.target.files?.[0])}
                          type="file"
                        />
                      </label>
                    )}
                  </td>
                  <td className="no-print">
                    <input
                      checked={invoice.statementChecked || invoice.statementComplete}
                      disabled={!canManageDrivewiseAccounting || invoice.statementComplete}
                      onChange={(event) =>
                        toggleInvoiceStatus(invoice.repair.id, invoice, { statementChecked: event.target.checked })
                      }
                      type="checkbox"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        )}

        {canViewDrivewiseRecords && activeView === 'repairs' && (
        <section className="panel">
          <div className="section-heading admin-heading-row">
            <div>
              <p className="eyebrow">Repairs</p>
              <h2>Vehicle Repair Records</h2>
            </div>
            <div className="view-toggle">
              <button
                className={repairView === 'vehicle' ? 'active' : ''}
                onClick={() => setRepairView('vehicle')}
                type="button"
              >
                By vehicle
              </button>
              <button
                className={repairView === 'vendor' ? 'active' : ''}
                onClick={() => setRepairView('vendor')}
                type="button"
              >
                By vendor
              </button>
            </div>
          </div>
          <div className="drivewise-repair-list">
            {groupedRepairs.map((group) => (
              <section className="repair-group" key={group.label}>
                <h3>{group.label}</h3>
                {group.repairs.map((repair) => (
                  <div className="regular-admin-row drivewise-repair-row" key={`${group.label}-${repair.id}`}>
                    <span>
                      <strong>{repair.ownerName}</strong><br />
                      <span className="repair-date-line">Repair date: {formatRepairDate(repair.repairDate)}</span><br />
                      {vehicleLabel(repair)}
                      {repair.payer ? ` - Payer: ${repair.payer}` : ''}
                      {repairHasCompletedStatement(repair) ? ' - Statement complete' : ''}
                    </span>
                    {canManageDrivewiseRepairs && (
                    <div>
                      {repairHasCompletedStatement(repair) ? (
                        <button className="text-action" onClick={() => viewRepair(repair)} type="button">View</button>
                      ) : (
                        <button className="text-action" onClick={() => editRepair(repair)} type="button">Edit</button>
                      )}
                      {data.role === 'full' && !repairHasCompletedStatement(repair) && (
                        <button className="text-action" onClick={() => deleteRepair(repair.id)} type="button">Delete</button>
                      )}
                    </div>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </section>
        )}

        {data.role === 'full' && canManageMainAccount && adminAccountPanel}

        {message && <p className="success-message admin-message">{message}</p>}
        {error && <p className="error-message admin-message">{error}</p>}
      </section>
    </main>
  )
}

function emptyDrivewiseRepair() {
  return {
    id: '',
    repairDate: '',
    ownerName: '',
    year: '',
    make: '',
    model: '',
    vehicleInfo: '',
    vehicleTrackingId: '',
    payer: '',
    neededRepairs: '',
    status: 'Open',
    notes: '',
    notesFileName: '',
    notesFileContentType: '',
    notesFileData: '',
    notesFilePreviewUrl: '',
    notesFile: null,
    invoices: [emptyDrivewiseInvoice()],
  }
}

function emptyDrivewiseInvoice() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    vendor: '',
    invoiceNumber: '',
    partDescription: '',
    cost: '',
    fileName: '',
    fileContentType: '',
    fileData: '',
    filePreviewUrl: '',
    statementChecked: false,
    paid: false,
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('The invoice file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function vehicleLabel(repair) {
  return [repair.year, repair.make, repair.model].filter(Boolean).join(' ') || repair.vehicleInfo || ''
}

function groupRepairs(repairs, mode) {
  const groups = new Map()
  const sortedRepairs = [...repairs].sort((a, b) =>
    (b.repairDate || '').localeCompare(a.repairDate || '') ||
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  )
  for (const repair of sortedRepairs) {
    const labels = mode === 'vendor'
      ? [...new Set((repair.invoices || []).map((invoice) => invoice.vendor).filter(Boolean))]
      : [repair.vehicleTrackingId || repair.id || vehicleLabel(repair) || 'Unknown vehicle']
    for (const label of labels.length ? labels : ['No vendor']) {
      const group = groups.get(label) || {
        label: mode === 'vendor' ? label : vehicleLabel(repair) || 'Unknown vehicle',
        repairs: [],
        latestRepairDate: repair.repairDate || '',
      }
      group.repairs.push(repair)
      if ((repair.repairDate || '') > group.latestRepairDate) group.latestRepairDate = repair.repairDate || ''
      groups.set(label, group)
    }
  }
  return [...groups.values()].sort((a, b) =>
    (b.latestRepairDate || '').localeCompare(a.latestRepairDate || '') ||
    a.label.localeCompare(b.label),
  )
}

function adminRoleLabel(accessLevel) {
  if (accessLevel === 'admin') return 'Admin - all except admin account setup'
  if (accessLevel === 'accounting') return 'Accounting only'
  if (accessLevel === 'schedule') return 'Repairs only'
  return accessLevel || 'Repairs only'
}

function App() {
  return <DrivewiseAdminApp />
}

export default App


