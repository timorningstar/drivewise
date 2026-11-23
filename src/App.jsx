import MechanicPage from './MechanicPage'
import IntakeWorkflow from './IntakeWorkflow'
import DrivewiseSetup from './DrivewiseSetup'
import CustomerApplication from './CustomerApplication'
import DrivewiseHeader from './DrivewiseHeader'
import CorrectionDialog, {InvoiceHistory,StatementCell} from './CorrectionDialog'
import MoveInvoiceDialog from './MoveInvoiceDialog'
import {vehicleRepairComplete,vehicleRepairOpen,vehicleRepairRecord} from './drivewise-dashboard'
import CustomerPayments, {NotificationSettings} from './CustomerPayments'
import { useEffect, useState, useRef } from 'react'
import {onAuthStateChanged,signInWithCustomToken,signOut,setPersistence,browserSessionPersistence} from 'firebase/auth'
import {auth} from './firebase'
import {handleHubSso} from './hub-sso'
import './App.css'

const DRIVEWISE_APP_ID = 'drivewise'
const TESTING = import.meta.env.VITE_DRIVEWISE_TESTING === true
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const DRIVEWISE_TOKEN_KEY = 'drivewiseAdminToken'
const HIDDEN_VENDOR_LIST_NAMES = new Set(['amazon - % todd lehman'])
const VENDOR_NAME_OVERRIDES = new Map([
  ['federated', 'Federated Auto'],
  ['federated auto', 'Federated Auto'],
])

async function drivewiseFetch(url,options={}) {
  if(options.headers?.Authorization?.split(' ')[1]?.split('.').length===3&&auth.currentUser){options={...options,headers:{...options.headers,Authorization:'Bearer '+await auth.currentUser.getIdToken()}};}
  return fetch(url,options)
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value || 0)
}

function repairIsReadOnly(repair) {if(repair.correctionOpen)return false;return Boolean(repair.historicalComplete)||Boolean(repair.customerAccount?.closedAt)||repairHasCompletedStatement(repair)}

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function isShopSupplyRecord(repair) {
  return repair.recordType === 'shopSupply'
}

function isHiddenVendorListName(vendor) {
  return HIDDEN_VENDOR_LIST_NAMES.has(String(vendor || '').trim().toLowerCase())
}

function normalizeVendorName(vendor) {
  const trimmed = String(vendor || '').trim()
  return VENDOR_NAME_OVERRIDES.get(trimmed.toLowerCase()) || trimmed
}

function repairOwnerVehicleLabel(repair) {
  if (isShopSupplyRecord(repair)) return 'Shop Supplies'
  return `${repair.ownerName}\n${vehicleLabel(repair)}`
}

function invoiceOwnerLabel(invoice) {
  return isShopSupplyRecord(invoice.repair) ? 'Shop Supplies' : invoice.repair.ownerName || ''
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''))
}

function DrivewiseAdminApp() {
  const [token, setToken] = useState('')
  const [authReady,setAuthReady]=useState(false)
  const [hubEntry,setHubEntry]=useState(()=>window.location.hash.startsWith('#dtm-'))
  const [login, setLogin] = useState({ username: '', password: '' })
  const [data, setData] = useState(null)
  const [repairForm, setRepairForm] = useState(emptyDrivewiseRepair())
  const [activeView, setActiveView] = useState(TESTING?'workflow':'repairs')
  const [workflowSelection,setWorkflowSelection]=useState('')
  const [repairScope,setRepairScope] = useState('open')
  const [filters, setFilters] = useState({ vendor: 'all', statement: 'unchecked' })
  const [supplyFilters, setSupplyFilters] = useState({ vendor: 'all', statement: 'unchecked' })
  const [repairView, setRepairView] = useState('vehicle')
  const [accountForm, setAccountForm] = useState({ username: '', password: '' })
  const [regularForm, setRegularForm] = useState({
    username: '',
    password: '',
    accessLevel: 'admin',
  })
  const [confirmedNewVendorKeys, setConfirmedNewVendorKeys] = useState(new Set())
  const [pendingVendorPromptKeys, setPendingVendorPromptKeys] = useState(new Set())
  const [touchedVendorKeys, setTouchedVendorKeys] = useState(new Set())
  const [share,setShare]=useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const savingRepair = useRef(false)
  const [repairSaving,setRepairSaving] = useState(false)
  const [correctionTarget,setCorrectionTarget]=useState(null)
  const [statementDate,setStatementDate]=useState('')
  const [statementSaving,setStatementSaving]=useState(false)
  const [moveTarget,setMoveTarget]=useState(null)

  const authHeaders = (activeToken = token) => ({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${activeToken}`,
  })
  const customerRequest = async (path,body,blob=false) => {
    const response=await drivewiseFetch(apiUrl(path),{method:blob?'GET':'POST',headers:authHeaders(),...(blob?{}:{body:JSON.stringify(body)})})
    if(blob){if(!response.ok)throw Error('Could not download the diagnostic form.');return response.blob()}
    const result=await response.json()
    if(!response.ok)throw Error(result.error||'Could not save this change.')
    return result
  }

  const loadDrivewiseState = async (activeToken = token) => {
    const response = await drivewiseFetch(apiUrl(`/api/drivewise-state?app=${DRIVEWISE_APP_ID}`), {
      headers: authHeaders(activeToken),
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'DriveWise admin session expired.')
    }
    setData(normalizeDrivewisePayload(payload))
    setAccountForm({ username: payload.mainAdminUsername || '', password: '' })
    if(TESTING&&payload.role!=='recovery') setActiveView('workflow')
    if (payload.role === 'recovery') setActiveView('entry')
    const linkedId=new URLSearchParams(window.location.search).get('repair')||sessionStorage.getItem('drivewise-requested-repair')
    const linkedRepair=linkedId&&payload.role!=='recovery'&&payload.repairs?.find(r=>r.id===linkedId)
    if(linkedRepair){sessionStorage.removeItem('drivewise-requested-repair');setRepairForm({...linkedRepair,invoices:linkedRepair.invoices?.length?linkedRepair.invoices:[emptyDrivewiseInvoice()]});setActiveView('entry');window.history.replaceState(null,'',window.location.pathname)}
    const applicationId=new URLSearchParams(window.location.search).get('application')||sessionStorage.getItem('drivewise-requested-application')
    if(TESTING&&applicationId&&payload.repairs?.some(r=>r.id===applicationId)){setWorkflowSelection(applicationId);setActiveView('workflow');sessionStorage.removeItem('drivewise-requested-application');window.history.replaceState(null,'',window.location.pathname)}
    setError('')
  }

  useEffect(()=>{let unsubscribe;let active=true;
    (async()=>{try{
      if(await handleHubSso({app:'drivewise',signIn:async value=>{await setPersistence(auth,browserSessionPersistence);await signInWithCustomToken(auth,value)},logout:()=>signOut(auth)}))return;
      unsubscribe=onAuthStateChanged(auth,async user=>{if(!active)return;if(!user){setAuthReady(true);return;}try{const value=await user.getIdToken();if(active){setToken(value);await loadDrivewiseState(value);}}catch(e){if(active)setError(e.message);}finally{if(active)setAuthReady(true);}});
    }catch(e){if(active){setError(e.message);setAuthReady(true);}}})();return()=>{active=false;unsubscribe?.();};
  // Auth initializes once; the state loader receives the fresh token explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const handleLogin = async (event) => {
    event.preventDefault()
    setError('')
    try {
      const response = await drivewiseFetch(apiUrl(`/api/admin-login?app=${DRIVEWISE_APP_ID}`), {
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

  const openMechanicShare=async repairId=>{setError('');try{const response=await drivewiseFetch(apiUrl('/api/drivewise-mechanic-share'),{method:'POST',headers:authHeaders(),body:JSON.stringify({repairId})});const result=await readJsonPayload(response);if(!response.ok)throw Error(result.error||'Could not create mechanic link.');setShare(result);}catch(e){setError(e.message)}}
  const revokeMechanicShare=async repairId=>{if(!window.confirm('Revoke the current mechanic link for this repair?'))return;try{const response=await drivewiseFetch(apiUrl('/api/drivewise-mechanic-revoke'),{method:'POST',headers:authHeaders(),body:JSON.stringify({repairId})});if(!response.ok)throw Error('Could not revoke the link.');setMessage('Mechanic link revoked.')}catch(e){setError(e.message)}}

  const saveRepair = async (event) => {
    event.preventDefault()
    if(savingRepair.current)return
    setError('')
    setMessage('')
    if (needsVehicleDecision) {
      setError('Choose whether this is the same vehicle or a different vehicle before saving.')
      return
    }
    if ((repairForm.invoices || []).some((invoice) => String(invoice.vendor || '').trim().length === 1)) {
      setError('Vendor names must be at least 2 characters.')
      return
    }
    const unresolvedVendor = findUnresolvedVendorPrompt(repairForm)
    if (unresolvedVendor) {
      showVendorPrompt(unresolvedVendor.invoice, unresolvedVendor.likelyVendor)
      setError(`Confirm whether ${unresolvedVendor.typed} is a new vendor or ${unresolvedVendor.likelyVendor}.`)
      return
    }
    savingRepair.current=true
    setRepairSaving(true)
    const shareAfterSave=isNewVehicleRequest
    try {
      const repairToSave = await prepareRepairForSave(repairForm)
      setRepairForm(repairToSave)
      const response = await drivewiseFetch(apiUrl(`/api/drivewise-repair?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ repair: repairToSave }),
      })
      const payload = await readJsonPayload(response)
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Repair could not be saved.')
      setData(normalizeDrivewisePayload(payload))
      if (repairForm.recordType === 'shopSupply') {
        setRepairForm(emptyShopSupplyRecord())
        setMessage('Shop supply invoice saved.')
        setActiveView('supplies')
      } else {
        setRepairForm(emptyDrivewiseRepair())
        setMessage('DriveWise repair record saved.')
        if(shareAfterSave)setRepairScope('open')
        else if(repairForm.correctionOpen)setRepairScope(vehicleRepairComplete(payload.repairs.find(r=>r.id===repairToSave.id)||{})?'completed':'open')
        setActiveView('repairs')
        if(shareAfterSave)await openMechanicShare(repairToSave.id)
      }
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      savingRepair.current=false
      setRepairSaving(false)
    }
  }

  const prepareRepairForSave = async (repair) => {
    const repairId = repair.id || globalThis.crypto.randomUUID()
    let nextRepair = { ...repair, id: repairId }
    if (nextRepair.notesFileData) {
      const notesUpload = await uploadPendingFile({
        repairId,
        fileKind: 'notes',
        fileName: nextRepair.notesFileName,
        fileContentType: nextRepair.notesFileContentType,
        fileData: nextRepair.notesFileData,
      })
      nextRepair = {
        ...nextRepair,
        notesFile: notesUpload.notesFile,
        notesFileData: '',
        notesFileContentType: '',
        notesFileName: '',
      }
    }
    nextRepair.invoices = await Promise.all((nextRepair.invoices || []).map(async (invoice) => {
      if (!invoice.fileData) return invoice
      const invoiceId = invoice.id || globalThis.crypto.randomUUID()
      const upload = await uploadPendingFile({
        repairId,
        invoiceId,
        fileKind: 'invoice',
        fileName: invoice.fileName,
        fileContentType: invoice.fileContentType,
        fileData: invoice.fileData,
      })
      return {
        ...invoice,
        id: invoiceId,
        invoiceFile: upload.invoiceFile,
        fileData: '',
        fileContentType: '',
        fileName: '',
      }
    }))
    return nextRepair
  }

  const uploadPendingFile = async (body) => {
    const response = await drivewiseFetch(apiUrl(`/api/drivewise-file-upload?app=${DRIVEWISE_APP_ID}`), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    })
    const payload = await readJsonPayload(response)
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'File could not be uploaded.')
    return payload
  }

  const deleteRepair = async (id, options = {}) => {
    const label = options.label || 'repair record'
    if (options.confirm && !window.confirm(`Delete this ${label}?`)) return
    setError('')
    setMessage('')
    try {
      const response = await drivewiseFetch(apiUrl(`/api/drivewise-delete-repair?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || `${label} could not be deleted.`)
      setData(normalizeDrivewisePayload(payload))
      setMessage(`${label.charAt(0).toUpperCase()}${label.slice(1)} deleted.`)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  const toggleInvoiceStatus = async (repairId, invoice, updates) => {
    setError('')
    setMessage('')
    try {
      const response = await drivewiseFetch(apiUrl(`/api/drivewise-invoice-status?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ repairId, invoiceId: invoice.id, updates }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Invoice status could not be updated.')
      setData(normalizeDrivewisePayload(payload))
    } catch (statusError) {
      setError(statusError.message)
    }
  }

  const completeStatementInvoices = async () => {
    if (!statementInvoices.length) return
    if(statementSaving)return
    if(!statementDate){setError('Enter the statement date once for all selected invoices.');return}
    if (!window.confirm('Mark the selected statement invoices complete? Completed invoices will be locked from editing.')) {
      return
    }
    setError('')
    setMessage('')
    setStatementSaving(true)
    try {
      const response = await drivewiseFetch(apiUrl(`/api/drivewise-complete-statement?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          statementDate,
          invoices: statementInvoices.map((invoice) => ({
            repairId: invoice.repair.id,
            invoiceId: invoice.id,
          })),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Statement invoices could not be completed.')
      setData(normalizeDrivewisePayload(payload))
      setMessage('Statement invoices marked complete.')
      setStatementDate('')
      setFilters(current=>({...current,statement:'checked'}))
    } catch (completeError) {
      setError(completeError.message)
    } finally {
      setStatementSaving(false)
    }
  }

  const saveMainAccount = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      const response = await drivewiseFetch(apiUrl(`/api/admin-main-account?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(accountForm),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Full-admin account could not be updated.')
      }
      setData(normalizeDrivewisePayload(payload))
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
      const response = await drivewiseFetch(apiUrl(`/api/admin-regular-admins?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(regularForm),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Admin account could not be added.')
      }
      setData(normalizeDrivewisePayload(payload))
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
      const response = await drivewiseFetch(apiUrl(`/api/admin-delete-regular-admin?app=${DRIVEWISE_APP_ID}`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Admin account could not be deleted.')
      }
      setData(normalizeDrivewisePayload(payload))
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
      const response = await drivewiseFetch(apiUrl(`/api/drivewise-invoice-file?app=${DRIVEWISE_APP_ID}`), {
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
      setData(normalizeDrivewisePayload(payload))
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
    const normalizedUpdates = 'vendor' in updates
      ? { ...updates, vendor: normalizeVendorName(updates.vendor) }
      : updates
    if ('vendor' in updates) {
      setPendingVendorPromptKeys((current) => {
        const next = new Set([...current].filter((key) => !key.startsWith(`${repairForm.invoices[index]?.id}:`)))
        return next
      })
      setTouchedVendorKeys((current) => {
        const next = new Set([...current].filter((key) => !key.startsWith(`${repairForm.invoices[index]?.id}:`)))
        return next
      })
    }
    setRepairForm((current) => ({
      ...current,
      invoices: current.invoices.map((invoice, invoiceIndex) =>
        invoiceIndex === index ? { ...invoice, ...normalizedUpdates } : invoice,
      ),
    }))
  }

  const vendorKey = (invoice, vendor) => `${invoice.id}:${String(vendor || '').trim().toLowerCase()}`

  const likelyVendorForValue = (value) => {
    const typed = String(value || '').trim().toLowerCase()
    if (typed.length < 2) return ''
    const candidates = vendors.filter((vendor) => {
      const candidate = vendor.toLowerCase()
      return candidate !== typed
    })
    return candidates.find((vendor) => vendor.toLowerCase().startsWith(typed)) ||
      candidates.find((vendor) => vendor.toLowerCase().split(/[^a-z0-9]+/).some((part) => part.startsWith(typed))) ||
      candidates.find((vendor) => vendor.toLowerCase().includes(typed)) ||
      ''
  }

  const findUnresolvedVendorPrompt = (repair) => {
    for (const invoice of repair.invoices || []) {
      const likelyVendor = likelyVendorForValue(invoice.vendor)
      if (likelyVendor && !confirmedNewVendorKeys.has(vendorKey(invoice, invoice.vendor))) {
        return { invoice, typed: invoice.vendor, likelyVendor }
      }
    }
    return null
  }

  const showVendorPrompt = (invoice, likelyVendor = likelyVendorForValue(invoice.vendor)) => {
    markVendorTouched(invoice)
    if (!likelyVendor || confirmedNewVendorKeys.has(vendorKey(invoice, invoice.vendor))) return
    setPendingVendorPromptKeys((current) => {
      const next = new Set(current)
      next.add(vendorKey(invoice, invoice.vendor))
      return next
    })
  }

  const markVendorTouched = (invoice) => {
    const vendor = String(invoice.vendor || '').trim()
    if (!vendor) return
    setTouchedVendorKeys((current) => {
      const next = new Set(current)
      next.add(vendorKey(invoice, invoice.vendor))
      return next
    })
  }

  const shouldShowVendorLengthError = (invoice) => {
    const vendor = String(invoice.vendor || '').trim()
    return vendor.length === 1 && touchedVendorKeys.has(vendorKey(invoice, invoice.vendor))
  }

  const shouldShowVendorPrompt = (invoice) => {
    const likelyVendor = likelyVendorForValue(invoice.vendor)
    return Boolean(
      likelyVendor &&
      pendingVendorPromptKeys.has(vendorKey(invoice, invoice.vendor)) &&
      !confirmedNewVendorKeys.has(vendorKey(invoice, invoice.vendor)),
    )
  }

  const acceptLikelyVendor = (index, likelyVendor) => {
    updateInvoice(index, { vendor: likelyVendor })
  }

  const keepNewVendor = (invoice) => {
    setConfirmedNewVendorKeys((current) => {
      const next = new Set(current)
      next.add(vendorKey(invoice, invoice.vendor))
      return next
    })
  }

  const removeInvoice = (index) => {
    setRepairForm((current) => ({
      ...current,
      invoices: current.invoices.filter((_, invoiceIndex) => invoiceIndex !== index),
    }))
  }

  const editRepair = (repair) => {
    if (repairIsReadOnly(repair)) {
      viewRepair(repair)
      return
    }
    setRepairForm({
      ...repair,
      agreedCharge:repair.customerAccount?.chargeCents===null||repair.customerAccount?.chargeCents===undefined?'':(repair.customerAccount.chargeCents/100).toFixed(2),
      invoices: repair.invoices?.length ? repair.invoices : [emptyDrivewiseInvoice()],
    })
    setActiveView('entry')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const viewRepair = (repair) => {
    setRepairForm({
      ...repair,
      agreedCharge:repair.customerAccount?.chargeCents===null||repair.customerAccount?.chargeCents===undefined?'':(repair.customerAccount.chargeCents/100).toFixed(2),
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

  const startShopSupplies = () => {
    setRepairForm(emptyShopSupplyRecord())
    setMessage('')
    setError('')
    setActiveView('supplies')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const printStatementWithInvoices = () => {
    const rows = statementInvoices.map((invoice) => {
      const href = invoiceFileHref(invoice)
      const contentType = invoice.invoiceFile?.contentType || invoice.fileContentType || ''
      const invoiceFrame = href && contentType === 'application/pdf'
        ? `<object class="invoice-media invoice-pdf" data="${escapeHtml(href)}" type="application/pdf"><a href="${escapeHtml(href)}">Open invoice PDF</a></object>`
        : href
          ? `<img class="invoice-media invoice-image" src="${escapeHtml(href)}" alt="Invoice ${escapeHtml(invoice.invoiceNumber)}" />`
          : '<p>Invoice file missing.</p>'
      return {
        tableRow: `<tr><td>${escapeHtml(invoice.vendor)}</td><td>${escapeHtml(invoice.invoiceNumber)}</td><td>${escapeHtml(repairOwnerVehicleLabel(invoice.repair)).replace(/\n/g, '<br>')}</td><td>${escapeHtml(formatCurrency(invoice.cost))}</td></tr>`,
        invoicePage: `<section class="invoice-page"><h2>${escapeHtml(invoice.vendor)} - Invoice ${escapeHtml(invoice.invoiceNumber)}</h2>${invoiceFrame}</section>`,
      }
    })
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('The print window was blocked. Allow pop-ups for DriveWise and try again.')
      return
    }
    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>DriveWise statement invoices</title>
          <style>
            @page { margin: 0.35in; size: letter portrait; }
            * { box-sizing: border-box; }
            body { color: #111827; font-family: Arial, sans-serif; margin: 0; }
            h1 { font-size: 24px; margin: 0 0 16px; }
            h2 { font-size: 16px; line-height: 1.2; margin: 0 0 8px; }
            table { border-collapse: collapse; margin-bottom: 24px; width: 100%; }
            th, td { border-bottom: 1px solid #cbd5e1; padding: 8px; text-align: left; }
            th { color: #475569; font-size: 12px; text-transform: uppercase; }
            .statement-page { break-after: page; page-break-after: always; }
            .invoice-page {
              break-before: page;
              display: flex;
              flex-direction: column;
              height: 10.3in;
              overflow: hidden;
              page-break-before: always;
              page-break-inside: avoid;
            }
            .invoice-media {
              border: 0;
              display: block;
              height: 9.85in;
              margin-left: auto;
              margin-right: auto;
              max-height: 9.85in;
              max-width: 100%;
              object-fit: contain;
              object-position: top center;
              width: 100%;
            }
            .invoice-image { object-fit: contain; }
            .invoice-pdf { background: #fff; }
          </style>
        </head>
        <body>
          <section class="statement-page">
            <h1>Invoices Selected for Payment</h1>
            <table>
              <thead><tr><th>Vendor</th><th>Invoice #</th><th>Owner / Vehicle</th><th>Cost</th></tr></thead>
              <tbody>${rows.map((row) => row.tableRow).join('')}</tbody>
            </table>
          </section>
          ${rows.map((row) => row.invoicePage).join('')}
          <script>
            const images = Array.from(document.images);
            Promise.all(images.map((image) => image.complete ? true : new Promise((resolve) => {
              image.onload = resolve;
              image.onerror = resolve;
            }))).finally(() => setTimeout(() => window.print(), 2200));
          </script>
        </body>
      </html>`)
    printWindow.document.close()
  }

  const logout = () => {
    if(data?.hubSession){window.location.assign('https://dtmapp.web.app');return;}
    sessionStorage.removeItem(DRIVEWISE_TOKEN_KEY)
    setToken('')
    setData(null)
  }

  const repairs = data?.repairs || []
  const canManageDrivewiseRepairs = ['full', 'admin', 'schedule'].includes(data?.role)
  const canManageDrivewiseAccounting = ['full', 'admin', 'accounting'].includes(data?.role)
  const canManageMainAccount = !data?.hubSession && ['full', 'recovery'].includes(data?.role)
  const canManageRegularAdmins = !data?.hubSession && data?.role === 'full'
  const canDeleteUnlockedDrivewiseRecords = ['full', 'accounting'].includes(data?.role) || data?.accessLevels?.includes('accounting')
  const canViewDrivewiseRecords = data?.role !== 'recovery'
  const isRepairFormReadOnly = repairForm.id && (!canManageDrivewiseRepairs || repairIsReadOnly(repairForm))
  const isNewVehicleRequest=repairForm.recordType!=='shopSupply'&&!repairs.some(repair=>repair.id===repairForm.id)
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
  const vendors = [
    ...new Set(invoices.map((invoice) => invoice.vendor).filter((vendor) => vendor && !isHiddenVendorListName(vendor))),
  ].sort()
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
  const isStatementSort = ['owner', 'vehicle'].includes(filters.statement)
  const filteredInvoices = invoices.filter((invoice) => {
    const vendorMatches = filters.vendor === 'all' || invoice.vendor === filters.vendor
    const statementMatches =
      isStatementSort ||
      filters.statement === 'all' ||
      (filters.statement === 'unchecked' && !invoice.statementComplete && !invoice.statementChecked) ||
      (filters.statement === 'checked' && invoice.statementComplete)
    return vendorMatches && statementMatches
  }).sort((a, b) => {
    if (filters.statement === 'owner') {
      return compareText(invoiceOwnerLabel(a), invoiceOwnerLabel(b)) ||
        compareText(vehicleLabel(a.repair), vehicleLabel(b.repair)) ||
        compareText(a.vendor, b.vendor) ||
        compareText(a.invoiceNumber, b.invoiceNumber)
    }
    if (filters.statement === 'vehicle') {
      return compareText(vehicleLabel(a.repair), vehicleLabel(b.repair)) ||
        compareText(invoiceOwnerLabel(a), invoiceOwnerLabel(b)) ||
        compareText(a.vendor, b.vendor) ||
        compareText(a.invoiceNumber, b.invoiceNumber)
    }
    return Number(a.statementComplete) - Number(b.statementComplete) ||
      Number(a.statementChecked) - Number(b.statementChecked) ||
      compareText(a.vendor, b.vendor) ||
      compareText(a.invoiceNumber, b.invoiceNumber)
  })
  const statementInvoices = openInvoices
    .filter((invoice) => invoice.statementChecked)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.invoiceNumber.localeCompare(b.invoiceNumber))
  const groupedRepairs = groupRepairs(repairs.filter((repair) => repair.recordType!=='shopSupply'&&(!TESTING||vehicleRepairRecord(repair))&&(repairScope==='all'||(repairScope==='completed'?vehicleRepairComplete(repair):(TESTING?vehicleRepairOpen(repair):!vehicleRepairComplete(repair))))), repairView)
  const shopSupplyRecords = repairs
    .filter(isShopSupplyRecord)
    .sort((a, b) => (b.repairDate || '').localeCompare(a.repairDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
  const supplyVendors = [...new Set(shopSupplyRecords.flatMap((record) =>
    (record.invoices || []).map((invoice) => invoice.vendor).filter(Boolean),
  ))].sort((a, b) => a.localeCompare(b))
  const filteredSupplyInvoices = shopSupplyRecords.flatMap((record) =>
    (record.invoices || []).map((invoice) => ({ record, invoice })),
  ).filter(({ invoice }) => {
    const vendorMatches = supplyFilters.vendor === 'all' || invoice.vendor === supplyFilters.vendor
    const statementMatches = supplyFilters.statement === 'all' ||
      (supplyFilters.statement === 'unchecked' && !invoice.statementComplete && !invoice.statementChecked) ||
      (supplyFilters.statement === 'checked' && !invoice.statementComplete && invoice.statementChecked) ||
      (supplyFilters.statement === 'complete' && invoice.statementComplete)
    return vendorMatches && statementMatches
  })
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

  if(!authReady)return <main><section className="panel"><h1>DriveWise</h1><p role="status">Opening your DTM workspace...</p></section></main>

  if(!data&&hubEntry)return <main><section className="panel"><h1>DriveWise</h1><p role="status">{error||'Opening your DTM workspace...'}</p><a href="https://dtmapp.web.app">Return to DTM Hub</a>{!TESTING&&<button type="button" onClick={()=>setHubEntry(false)}>Use an existing DriveWise login</button>}</section></main>

  if(!data&&TESTING)return <main className="drivewise-workspace"><section className="panel"><h1>DriveWise Testing</h1><p>Separate test records and uploads. Use your existing DTM Hub login and app permissions.</p>{error&&<p role="alert">{error}</p>}<a className="primary-action" href="/#dtm-hub">Sign in through DTM Hub</a></section></main>
  if (!data) {
    return (
      <main className="drivewise-workspace">
        <DrivewiseHeader data={{username:'',hubSession:true,role:'guest',repairs:[]}} canRepair={false} canView={false} onLogout={()=>window.location.assign('https://dtmapp.web.app')}/>

        <section className="admin-shell single-panel">
          <a className="primary-action" href="/#dtm-hub">Sign in through DTM Hub</a><form className="panel admin-login-panel" onSubmit={handleLogin}>
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
    <main className="drivewise-workspace">
      {moveTarget&&<MoveInvoiceDialog target={moveTarget} repairs={repairs} request={customerRequest} onClose={()=>setMoveTarget(null)} onDone={result=>{setData(normalizeDrivewisePayload(result));setMessage('Invoice moved. Its source, destination and reason are retained in the history.')}}/>}
      {correctionTarget&&<CorrectionDialog key={correctionTarget.repairId+':'+(correctionTarget.invoiceId||'repair')} target={correctionTarget} request={customerRequest} onClose={()=>setCorrectionTarget(null)} onDone={(result,target)=>{
        setData(normalizeDrivewisePayload(result))
        if(target.kind==='repair'){
          const repair=result.repairs.find(r=>r.id===target.repairId)
          if(repair){setRepairForm({...repair,agreedCharge:repair.customerAccount?.chargeCents===undefined||repair.customerAccount?.chargeCents===null?'':(repair.customerAccount.chargeCents/100).toFixed(2),invoices:repair.invoices?.length?repair.invoices:[emptyDrivewiseInvoice()]});setRepairScope('open');setActiveView('entry')}
          setMessage('Repair reopened for corrections. Completed invoices remain locked until reversed.')
        }else {
          setFilters(current=>({...current,statement:'all'}))
          const fresh=result.repairs.find(r=>r.id===target.repairId)
          if(fresh)setRepairForm(current=>current.id===fresh.id?{...current,revision:fresh.revision,invoices:current.invoices.map(invoice=>invoice.id===target.invoiceId?fresh.invoices.find(i=>i.id===invoice.id):invoice)}:current)
          setMessage('Invoice verification reversed. The reason and prior statement date remain in its history.')
        }
      }}/>}
      {share&&<div className="mechanic-backdrop"><section role="dialog" aria-modal="true" aria-label="Share mechanic repair link" className="panel mechanic-share"><h2>Share mechanic repair link</h2><p>The mechanic can use this link for 30 days without signing in. Creating another link replaces the previous one.</p><label>Repair link<input readOnly value={share.url}/></label><div className="header-actions"><button type="button" onClick={()=>navigator.clipboard.writeText(share.url).then(()=>setMessage('Link copied.')).catch(()=>setMessage('Select and copy the repair link.'))}>Copy link</button><a href={'mailto:?subject='+encodeURIComponent('DTM vehicle repair')+'&body='+encodeURIComponent('Please review and complete this vehicle repair: '+share.url+'\nThis link expires in 30 days.')}>Email repair link</a><button type="button" onClick={()=>setShare(null)}>Close</button></div></section></div>}
      <DrivewiseHeader data={data} activeView={activeView} repairScope={repairScope} canRepair={canManageDrivewiseRepairs} canView={canViewDrivewiseRecords} canLegacyAdmin={canManageMainAccount}
        onView={setActiveView} onRepairs={scope=>{setRepairScope(scope);setActiveView('repairs')}} onNewRepair={TESTING?()=>setActiveView('newApplication'):startNewRepair} onNewSupply={startShopSupplies}
        onInvoices={()=>{setFilters({vendor:'all',statement:'unchecked'});setActiveView('invoices')}} onLogout={logout}/>


      <section className="admin-shell drivewise-shell">
        {TESTING&&['workflow','newApplication'].includes(activeView)&&<IntakeWorkflow key={activeView} data={data} request={customerRequest} onData={value=>setData(normalizeDrivewisePayload(value))} newRequest={activeView==='newApplication'} initialId={workflowSelection} onView={setActiveView}/>}
        {TESTING&&data.role==='full'&&activeView==='setup'&&<DrivewiseSetup initial={data.workflow} request={customerRequest} onData={value=>setData(normalizeDrivewisePayload(value))}/>}
        {canViewDrivewiseRecords&&activeView==='customerPayments'&&<CustomerPayments repairs={repairs} role={data.role} request={customerRequest} onAccount={(id,account)=>{
          setData(current=>({...current,repairs:current.repairs.map(r=>r.id===id?{...r,customerAccount:account}:r)}))
          setRepairForm(current=>current.id===id?{...current,customerAccount:account}:current)
        }}/>}
        {data.role==='full'&&activeView==='notifications'&&<NotificationSettings settings={data.notificationSettings} request={customerRequest} onSettings={recipients=>setData(current=>({...current,notificationSettings:{...current.notificationSettings,recipients}}))}/>}
        {data.role === 'recovery' && canManageMainAccount && adminAccountPanel}

        {(canManageDrivewiseRepairs || (canViewDrivewiseRecords && repairForm.id)) && activeView === 'entry' && (
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
                  : repairForm.correctionOpen ? 'Correct Repair Record'
                  : repairForm.id ? 'Edit Repair Record' : 'New Repair Record'}
              </h2>
            </div>
            <button
              className="secondary-action"
              onClick={canManageDrivewiseRepairs ? startNewRepair : () => setActiveView('repairs')}
              type="button"
            >
              {!canManageDrivewiseRepairs ? 'Back to vehicle records' : isRepairFormReadOnly ? 'New repair record' : 'Clear form'}
            </button>
          </div>

          {repairForm.correctionHistory?.length>0&&<details className="invoice-history"><summary>Repair correction history</summary>{repairForm.correctionHistory.map(entry=><article key={entry.id}><strong>{entry.openedBy} · {new Date(entry.openedAt).toLocaleString()}</strong><p className="repair-description">Reason: {entry.reason}</p>{entry.finishedAt&&<p>Corrections saved by {entry.finishedBy} · {new Date(entry.finishedAt).toLocaleString()}</p>}</article>)}</details>}
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
              {isNewVehicleRequest?'Payer *':'Payer'}
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({ ...current, payer: event.target.value }))
                }
                disabled={isRepairFormReadOnly}
                required={isNewVehicleRequest}
                value={repairForm.payer}
              />
            </label>
            {(isNewVehicleRequest||repairForm.correctionOpen)&&<label>
              Agreed charge ($)
              <input type="number" min="0" max="1000000" step="0.01" value={repairForm.agreedCharge||''} onChange={event=>setRepairForm(current=>({...current,agreedCharge:event.target.value}))}/>
              <small>Enter 0.00 if no payment is due. If not agreed yet, leave blank and enter it later under Customer payments.</small>
            </label>}
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

          {!isNewVehicleRequest&&<>
          <div className="date-editor-header">
            <strong>Parts and invoices</strong>
          </div>
          <div className="drivewise-invoice-editor">
            <datalist id={vendorDatalistId}>
              {vendors.map((vendor) => <option key={vendor} value={vendor} />)}
            </datalist>
            {repairForm.invoices.map((invoice, index) => {
              const invoiceReadOnly=isRepairFormReadOnly||Boolean(invoice.statementComplete)
              return (
              <div className="drivewise-invoice-card" key={invoice.id}>
                <div className="receipt-card-header">
                  <strong>Invoice {index + 1}</strong>
                  {!invoiceReadOnly && !invoice.statementHistory?.length && (
                    <button className="text-action" onClick={() => removeInvoice(index)} type="button">
                      Remove
                    </button>
                  )}
                </div>
                {invoice.statementComplete&&<p className="muted">Verified statement: {invoice.statementDate?formatRepairDate(invoice.statementDate):'Date not recorded'}. Reverse verification before editing this invoice.</p>}
                {invoice.statementComplete&&canManageDrivewiseAccounting&&<button className="text-action" type="button" onClick={()=>setCorrectionTarget({kind:'invoice',repairId:repairForm.id,invoiceId:invoice.id,label:`${invoice.vendor} · Invoice ${invoice.invoiceNumber}`})}>Reverse verification</button>}
                <InvoiceHistory invoice={invoice}/>
                <div className="field-grid">
                  <label>
                    Vendor
                    <input
                      disabled={invoiceReadOnly}
                      list={vendorDatalistId}
                      onBlur={() => showVendorPrompt(invoice)}
                      onChange={(event) => updateInvoice(index, { vendor: event.target.value })}
                      value={invoice.vendor}
                    />
                    {!invoiceReadOnly && shouldShowVendorPrompt(invoice) && (
                        <span className="vendor-confirmation">
                          <span>
                            Is this a new vendor or is this {likelyVendorForValue(invoice.vendor)}?
                          </span>
                          <span className="vendor-confirmation-actions">
                            <button
                              onClick={() => acceptLikelyVendor(index, likelyVendorForValue(invoice.vendor))}
                              type="button"
                            >
                              Use {likelyVendorForValue(invoice.vendor)}
                            </button>
                            <button onClick={() => keepNewVendor(invoice)} type="button">
                              New vendor
                            </button>
                          </span>
                        </span>
                    )}
                    {!invoiceReadOnly && shouldShowVendorLengthError(invoice) && (
                      <span className="vendor-field-error">
                        Vendor names must be at least 2 characters.
                      </span>
                    )}
                  </label>
                  <label>
                    Invoice #
                    <input
                      disabled={invoiceReadOnly}
                      onChange={(event) => updateInvoice(index, { invoiceNumber: event.target.value })}
                      value={invoice.invoiceNumber}
                    />
                  </label>
                  <label>
                    Part description
                    <input
                      disabled={invoiceReadOnly}
                      onChange={(event) => updateInvoice(index, { partDescription: event.target.value })}
                      value={invoice.partDescription}
                    />
                  </label>
                  <label>
                    Cost
                    <input
                      disabled={invoiceReadOnly}
                      onChange={(event) => updateInvoice(index, { cost: event.target.value })}
                      step="0.01"
                      type="number"
                      value={invoice.cost}
                    />
                  </label>
                  {!invoiceReadOnly && (
                    <label className="camera-upload-label">
                      Invoice image or PDF
                      <input
                        accept="image/jpeg,image/png,application/pdf"
                        capture="environment"
                        className="camera-upload-input"
                        onChange={(event) => handleInvoiceFile(index, event.target.files?.[0])}
                        required={repairForm.recordType==='shopSupply' && !invoice.invoiceFile && !invoice.fileData}
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
                  {invoiceReadOnly && (invoice.fileName || invoice.invoiceFile?.name) && (
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
            )})}
          </div>
          </>}
          {!isRepairFormReadOnly && (
            <div className="form-action-row">
              {!isNewVehicleRequest&&
              <button className="secondary-action" onClick={addInvoice} type="button">
                Add another invoice
              </button>}
              <button className="primary-action admin-save" type="submit" disabled={repairSaving}>{repairSaving?'Saving…':isNewVehicleRequest?'Save and share with mechanic':repairForm.correctionOpen?'Save corrections and close':'Save repair record'}</button>
            </div>
          )}
        </form>
        )}

        {canManageDrivewiseRepairs && activeView === 'supplies' && (
        <form className="panel admin-editor" onSubmit={saveRepair}>
          <div className="section-heading admin-heading-row">
            <div>
              <p className="eyebrow">Shop Supplies</p>
              <h2>Shop Supply Invoices</h2>
            </div>
            <button className="secondary-action" onClick={startShopSupplies} type="button">
              Clear form
            </button>
          </div>

          <div className="field-grid">
            <label>
              Invoice date *
              <input
                onChange={(event) =>
                  setRepairForm((current) => ({ ...current, repairDate: event.target.value }))
                }
                required
                type="date"
                value={repairForm.repairDate}
              />
            </label>
          </div>

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
                  <button className="text-action" onClick={() => removeInvoice(index)} type="button">
                    Remove
                  </button>
                </div>
                <div className="field-grid">
                  <label>
                    Vendor
                    <input
                      list={vendorDatalistId}
                      onBlur={() => showVendorPrompt(invoice)}
                      onChange={(event) => updateInvoice(index, { vendor: event.target.value })}
                      value={invoice.vendor}
                    />
                    {shouldShowVendorPrompt(invoice) && (
                        <span className="vendor-confirmation">
                          <span>
                            Is this a new vendor or is this {likelyVendorForValue(invoice.vendor)}?
                          </span>
                          <span className="vendor-confirmation-actions">
                            <button
                              onClick={() => acceptLikelyVendor(index, likelyVendorForValue(invoice.vendor))}
                              type="button"
                            >
                              Use {likelyVendorForValue(invoice.vendor)}
                            </button>
                            <button onClick={() => keepNewVendor(invoice)} type="button">
                              New vendor
                            </button>
                          </span>
                        </span>
                    )}
                    {shouldShowVendorLengthError(invoice) && (
                      <span className="vendor-field-error">
                        Vendor names must be at least 2 characters.
                      </span>
                    )}
                  </label>
                  <label>
                    Invoice #
                    <input
                      onChange={(event) => updateInvoice(index, { invoiceNumber: event.target.value })}
                      value={invoice.invoiceNumber}
                    />
                  </label>
                  <label>
                    Part description
                    <input
                      onChange={(event) => updateInvoice(index, { partDescription: event.target.value })}
                      value={invoice.partDescription}
                    />
                  </label>
                  <label>
                    Cost
                    <input
                      onChange={(event) => updateInvoice(index, { cost: event.target.value })}
                      step="0.01"
                      type="number"
                      value={invoice.cost}
                    />
                  </label>
                  <label className="camera-upload-label">
                    Invoice image or PDF
                    <input
                      accept="image/jpeg,image/png,application/pdf"
                      capture="environment"
                      className="camera-upload-input"
                      onChange={(event) => handleInvoiceFile(index, event.target.files?.[0])}
                      required={repairForm.recordType==='shopSupply' && !invoice.invoiceFile && !invoice.fileData}
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
                  </label>
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
          <div className="form-action-row">
            <button className="secondary-action" onClick={addInvoice} type="button">
              Add another invoice
            </button>
            <button className="primary-action admin-save" type="submit">Save shop supply invoices</button>
          </div>
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
                <option value="owner">By Owner</option>
                <option value="vehicle">By Vehicle</option>
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
                <button className="secondary-action" onClick={printStatementWithInvoices} type="button">
                  Print statement list with invoices
                </button>
                {canManageDrivewiseAccounting&&<div className="statement-close-controls"><label>Statement date (applies to all selected invoices)<input type="date" value={statementDate} onChange={event=>setStatementDate(event.target.value)} required disabled={statementSaving}/></label><button className="primary-action" onClick={completeStatementInvoices} type="button" disabled={statementSaving||!statementDate}>{statementSaving?'Closing…':'Close selected invoices'}</button></div>}
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
                  <td>
                    {isShopSupplyRecord(invoice.repair) ? (
                      'Shop Supplies'
                    ) : (
                      <>
                        {invoice.repair.ownerName}<br />{vehicleLabel(invoice.repair)}
                      </>
                    )}
                  </td>
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
                    {canManageDrivewiseAccounting&&!invoice.statementComplete&&<button className="text-action" type="button" onClick={()=>setMoveTarget({kind:'invoice',repairId:invoice.repair.id,item:invoice})}>Move / reclassify</button>}
                  </td>
                  <td className="no-print">
                    <StatementCell invoice={invoice} canAccount={canManageDrivewiseAccounting} formatDate={formatRepairDate} onCheck={checked=>toggleInvoiceStatus(invoice.repair.id,invoice,{statementChecked:checked})} onReverse={()=>setCorrectionTarget({kind:'invoice',repairId:invoice.repair.id,invoiceId:invoice.id,label:`${invoice.vendor} · Invoice ${invoice.invoiceNumber}`})}/>
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
              <h2>{repairScope==='open'?(TESTING?'Live vehicle repairs':'Open vehicle repairs'):repairScope==='completed'?'Completed vehicle repairs':'Vehicle repair records'}</h2>
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
            {groupedRepairs.length===0&&<p className="dw-empty">{repairScope==='open'?(TESTING?'No live repairs. New applications remain under Pending requests and diagnostics.':'No open vehicle repairs.'):repairScope==='completed'?'No completed vehicle repairs.':(TESTING?'No vehicle repairs recorded. Pending and denied applications remain under Pending Requests.':'No vehicle repairs recorded.')}</p>}
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
                      {repair.correctionOpen?' - Reopened for corrections':repair.historicalComplete?' - Repair complete':''}
                      {!repair.correctionOpen&&repair.customerAccount?.closedAt ? ' - Closed (customer balance paid)' : ''}
                      {repairHasCompletedStatement(repair) ? ' - Statement complete' : ''}
                      {repair.mechanic?.completedAt&&<strong> · Repair completed by {repair.mechanic.mechanicName}</strong>}
                      {repair.mechanic&&<details><summary>Mechanic updates and attachments</summary><p>Approximate mechanic hours: {repair.mechanic.approxHours??'Not recorded'}</p>{repair.mechanic.notes.map((entry,i)=><p key={i}>{entry.author}: {entry.body}</p>)}{repair.mechanic.files.map(file=><p key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a>{file.vendor&&<> · {file.vendor}</>}{file.invoiceNumber&&<> · Invoice {file.invoiceNumber}</>}{(canManageDrivewiseRepairs||canManageDrivewiseAccounting)&&<button className="text-action" type="button" onClick={()=>setMoveTarget({kind:'mechanic',repairId:repair.id,item:file})}>Move / reclassify</button>}</p>)}</details>}
                      {repair.invoiceTransfers?.length>0&&<details className="invoice-history"><summary>Invoice movement history</summary>{repair.invoiceTransfers.map(entry=><article key={entry.operationId}><strong>{entry.by} · {new Date(entry.at).toLocaleString()}</strong><p>From: {entry.fromLabel}<br/>To: {entry.toLabel}</p><p>Reason: {entry.reason}</p></article>)}</details>}
                    </span>
                    <div>
                      {canManageDrivewiseRepairs&&!repair.correctionOpen&&(repairIsReadOnly(repair)||vehicleRepairComplete(repair))&&<button className="text-action" type="button" onClick={()=>setCorrectionTarget({kind:'repair',repairId:repair.id,label:`${repair.ownerName} · ${vehicleLabel(repair)}`})}>Reopen for corrections</button>}
                      {canManageDrivewiseRepairs&&!repair.historicalComplete&&!repairIsReadOnly(repair)&&(!TESTING||repair.workflowStatus==='live')&&<><button className="text-action" type="button" onClick={()=>openMechanicShare(repair.id)}>Share with mechanic</button>
                      <button className="text-action" type="button" onClick={()=>revokeMechanicShare(repair.id)}>Revoke link</button></>}
                      {!canManageDrivewiseRepairs || repairIsReadOnly(repair) ? (
                        <button className="text-action" onClick={() => viewRepair(repair)} type="button">View</button>
                      ) : (
                        <button className="text-action" onClick={() => editRepair(repair)} type="button">Edit</button>
                      )}
                      {canManageDrivewiseRepairs && canDeleteUnlockedDrivewiseRecords && !repairIsReadOnly(repair) && !repair.customerAccount && !repair.historicalComplete && !repair.correctionHistory?.length && !repair.invoices?.some(i=>i.statementHistory?.length) && !repair.invoiceTransfers?.length && (
                        <button
                          className="text-action"
                          onClick={() => deleteRepair(repair.id, { confirm: true })}
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </section>
        )}

        {canViewDrivewiseRecords && activeView === 'supplyRecords' && (
        <section className="panel">
          <div className="section-heading admin-heading-row">
            <div>
              <p className="eyebrow">Shop Supplies</p>
              <h2>Shop Supplies Records</h2>
            </div>
          </div>
          <div className="schedule-filters no-print">
            <label>
              Vendor
              <select value={supplyFilters.vendor} onChange={(event) => setSupplyFilters((current) => ({ ...current, vendor: event.target.value }))}>
                <option value="all">All vendors</option>
                {supplyVendors.map((vendor) => <option key={vendor}>{vendor}</option>)}
              </select>
            </label>
            <label>
              Statement
              <select value={supplyFilters.statement} onChange={(event) => setSupplyFilters((current) => ({ ...current, statement: event.target.value }))}>
                <option value="all">All invoices</option>
                <option value="unchecked">Unchecked</option>
                <option value="checked">Selected for payment</option>
                <option value="complete">Statement complete</option>
              </select>
            </label>
          </div>
          <table className="schedule-table drivewise-table">
            <thead>
              <tr>
                <th>Invoice date</th>
                <th>Vendor</th>
                <th>Invoice #</th>
                <th>Part</th>
                <th>Cost</th>
                <th>Invoice</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSupplyInvoices.map(({ record, invoice }) => (
                  <tr key={`${record.id}-${invoice.id}`}>
                    <td>{formatRepairDate(record.repairDate)}</td>
                    <td>{invoice.vendor}</td>
                    <td>{invoice.invoiceNumber}</td>
                    <td>{invoice.partDescription}</td>
                    <td>{formatCurrency(invoice.cost)}</td>
                    <td>
                      {invoiceFileHref(invoice) ? (
                        <a href={invoiceFileHref(invoice)} rel="noreferrer" target="_blank">
                          Invoice
                        </a>
                      ) : (
                        'Missing'
                      )}
                    </td>
                    <td>
                      {canDeleteUnlockedDrivewiseRecords && !repairHasCompletedStatement(record) && !record.invoices?.some(i=>i.statementHistory?.length) && !record.invoiceTransfers?.length && (
                        <button
                          className="text-action"
                          onClick={() => deleteRepair(record.id, { confirm: true, label: 'shop supply invoice' })}
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                      {!canDeleteUnlockedDrivewiseRecords && !repairHasCompletedStatement(record) && 'View only'}
                      {repairHasCompletedStatement(record) && 'Locked'}
                      {!repairHasCompletedStatement(record)&&record.invoices?.some(i=>i.statementHistory?.length)&&'History retained'}
                    </td>
                  </tr>
              ))}
              {filteredSupplyInvoices.length === 0 && (
                <tr><td colSpan="7">No shop supply invoices match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        )}

        {data.role === 'full' && canManageMainAccount && activeView === 'admin' && adminAccountPanel}

        {message && <p className="success-message admin-message">{message}</p>}
        {error && <p className="error-message admin-message">{error}</p>}
      </section>
    </main>
  )
}

function emptyDrivewiseRepair() {
  return {
    id: '',
    recordType: 'repair',
    repairDate: '',
    ownerName: '',
    year: '',
    make: '',
    model: '',
    vehicleInfo: '',
    vehicleTrackingId: '',
    payer: '',
    agreedCharge: '',
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

function emptyShopSupplyRecord() {
  return {
    ...emptyDrivewiseRepair(),
    recordType: 'shopSupply',
    repairDate: todayIsoDate(),
    ownerName: 'Shop Supplies',
    vehicleInfo: 'Shop Supplies',
    neededRepairs: 'Shop supplies',
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

function normalizeDrivewisePayload(payload) {
  if (!payload || !Array.isArray(payload.repairs)) return payload
  return {
    ...payload,
    repairs: payload.repairs.map((repair) => ({
      ...repair,
      invoices: (repair.invoices || []).map((invoice) => ({
        ...invoice,
        vendor: normalizeVendorName(invoice.vendor),
      })),
    })),
    paymentBatches: (payload.paymentBatches || []).map((batch) => ({
      ...batch,
      vendor: normalizeVendorName(batch.vendor),
    })),
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

async function readJsonPayload(response) {
  const text = await response.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {
      error: response.status === 413
        ? 'The uploaded invoice files are too large to save at once. Try smaller photos or fewer invoices.'
        : text.slice(0, 180) || 'Request failed.',
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function vehicleLabel(repair) {
  if (isShopSupplyRecord(repair)) return 'Shop Supplies'
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
  const [mechanicToken]=useState(()=>{const params=new URLSearchParams(window.location.hash.slice(1));const token=params.get('mechanic');if(token){sessionStorage.setItem('drivewise-mechanic-link',token);window.history.replaceState(null,'',window.location.pathname+'#mechanic');return token;}return window.location.hash==='#mechanic'?sessionStorage.getItem('drivewise-mechanic-link'):null;});
  if(TESTING&&window.location.hash==='#apply')return <CustomerApplication/>
  return mechanicToken?<MechanicPage token={mechanicToken}/>:<DrivewiseAdminApp />
}

export default App


