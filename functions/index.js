const {assertRepairEditable} = require("./repair-status");
const {createMechanicService} = require("./mechanic");
const {hubSession} = require("./hub-access");
const {customerWorkflow} = require('./customer-workflow');
const {cents:customerCents} = require('./customer-account');
const {correctionService,preserveInvoiceHistory} = require('./corrections');
const {invoiceTransferService} = require('./invoice-transfer');
const {drivewiseMetrics,verifyMetricsCaller} = require('./service-metrics');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const admin = require("firebase-admin");
const crypto = require("crypto");
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

const {workflowService}=require("./intake-workflow");

admin.initializeApp();
setGlobalOptions({maxInstances: 1});

const db = admin.firestore();
const storage = admin.storage();
const storageBucketNames = [
  process.env.STORAGE_BUCKET,
  "dtmcleaners.firebasestorage.app",
  "dtmcleaners.appspot.com",
].filter(Boolean);
const APP_ID = "drivewise";
const adminSessionCollection = db.collection("adminSessions");
const mechanicWork=db.collection('drivewiseMechanicWork');
const mechanicLinks=db.collection('drivewiseMechanicLinks');
const customer=customerWorkflow({db,stateRef,workCollection:mechanicWork});
const corrections=correctionService({db,stateRef,logChange:logStateChange});
const moveInvoice=invoiceTransferService({db,stateRef,logChange:logStateChange});
const workflow=workflowService({db,stateRef,workCollection:mechanicWork,links:mechanicLinks,customer});
const mechanic=createMechanicService({
 repo:{link:async key=>(await mechanicLinks.doc(key).get()).data(),work:async id=>(await mechanicWork.doc(id).get()).data(),putLink:(key,value)=>mechanicLinks.doc(key).create(value),mutate:(id,change)=>customer.mutateWork(id,change)},
 readRepair:async id=>(await readState()).repairs.find(r=>r.id===id),
 saveFile:async(id,file)=>{const path=`drivewiseInvoices/${id}/mechanic-${file.id}`;const bucket=await saveInvoiceBufferToStorage(path,file.bytes,file.type);return {id:file.id,name:file.name,type:file.type,path,bucket,vendor:file.vendor||'',invoiceNumber:file.invoiceNumber||''};},
 signFile:async(file,expires)=>{const [url]=await storage.bucket(file.bucket).file(file.path).getSignedUrl({action:'read',expires});return url;},
 removeFile:file=>storage.bucket(file.bucket).file(file.path).delete(),
});
async function mechanicProgress(){const snapshot=await mechanicWork.get();const result=new Map();for(const row of snapshot.docs){const value=row.data();result.set(row.id,{sharedAt:value.sharedAt||'',completedAt:value.completedAt||'',mechanicName:value.mechanicName||'',approxHours:value.approxHours??null,transferHistory:value.transferHistory||[],notes:value.notes||[],files:await Promise.all((value.files||[]).map(async file=>({id:file.id,name:file.name,vendor:file.vendor||'',invoiceNumber:file.invoiceNumber||'',url:await signedStorageUrl(file.path,file.bucket)})))});}return result;}


function defaultState() {
  return {
    repairs: [],
    paymentBatches: [],
    adminLog: [],
    adminCredentials: {
      username: "admin",
      passwordHash: hashPassword("fair2026"),
    },
    recoveryAdminCredentials: {
      username: "ALF",
      passwordHash: hashPassword("GreenTree53"),
    },
    regularAdmins: [],
  };
}

function stateRef() {
  return db.collection("appState").doc(APP_ID);
}

async function readState() {
  const ref = stateRef();
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    const seeded = normalizeState(defaultState());
    await ref.set({
      state: seeded,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return seeded;
  }
  return normalizeState(snapshot.data().state);
}

async function writeState(nextState) {
  const normalized = normalizeState(nextState);
  await stateRef().set({
    state: normalized,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return normalized;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    ...defaultState(),
    ...source,
    repairs: Array.isArray(source.repairs) ? source.repairs.map(normalizeDrivewiseRepairVendors) : [],
    paymentBatches: Array.isArray(source.paymentBatches)
      ? source.paymentBatches.map((batch) => ({
        ...batch,
        vendor: normalizeVendorName(batch.vendor),
      }))
      : [],
    adminLog: Array.isArray(source.adminLog) ? source.adminLog : [],
    adminCredentials: normalizeCredentialRecord(source.adminCredentials || defaultState().adminCredentials),
    recoveryAdminCredentials: normalizeCredentialRecord(source.recoveryAdminCredentials || defaultState().recoveryAdminCredentials),
    regularAdmins: Array.isArray(source.regularAdmins)
      ? source.regularAdmins.map((record) => ({
        ...normalizeCredentialRecord(record),
        accessLevel: normalizeAccessLevel(record?.accessLevel),
      }))
      : [],
  };
}

function normalizeAccessLevel(accessLevel) {
  const normalized = clean(accessLevel).toLowerCase();
  if (normalized === "sdmin") return "admin";
  if (["full", "admin", "schedule", "accounting"].includes(normalized)) return normalized;
  return "schedule";
}

async function adminLogin(request) {
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  if (!username || !password) return {ok: false, error: "Enter an admin login and password."};

  const state = await readState();
  const passwordHash = hashPassword(password);
  const normalizedUsername = normalizeAdminLogin(username);
  let role = "";
  let adminId = "";
  let displayName = username;
  let forcePasswordChange = false;

  if (
    normalizeAdminLogin(state.adminCredentials?.username) === normalizedUsername
    && credentialMatches(state.adminCredentials, passwordHash, password)
  ) {
    role = "full";
    adminId = "main";
    displayName = state.adminCredentials.username;
  } else if (
    normalizeAdminLogin(state.recoveryAdminCredentials?.username) === normalizedUsername
    && credentialMatches(state.recoveryAdminCredentials, passwordHash, password)
  ) {
    role = "recovery";
    adminId = "recovery";
    displayName = state.recoveryAdminCredentials.username;
  } else {
    const regularAdmin = (state.regularAdmins || []).find((record) => (
      normalizeAdminLogin(record.username) === normalizedUsername
      && credentialMatches(record, passwordHash, password)
    ));
    if (regularAdmin) {
      role = normalizeAccessLevel(regularAdmin.accessLevel);
      adminId = regularAdmin.id;
      displayName = regularAdmin.username;
      forcePasswordChange = Boolean(regularAdmin.forcePasswordChange);
    }
  }

  if (!role) return {ok: false, error: "Invalid admin login."};

  const rawToken = crypto.randomBytes(32).toString("base64url");
  await adminSessionCollection.doc(hashToken(rawToken)).set({
    appId: APP_ID,
    role,
    adminId,
    username: displayName,
    forcePasswordChange,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
  });

  logStateChange(state, displayName, "Admin login", `${displayName} logged in as ${role}.`);
  await writeState(state);

  return {ok: true, token: rawToken, role, username: displayName};
}

async function requireAdmin(request, allowedRoles) {
  const token = clean((request.get("authorization") || "").replace(/^Bearer\s+/i, "") || request.query?.token);
  if (!token) {
    const error = new Error("Admin login required.");
    error.statusCode = 401;
    throw error;
  }

  if(token.split(".").length===3){
    const session=await hubSession(token,allowedRoles);
    if(routePath(request).startsWith("/admin-") || routePath(request)==="/drivewise-purge"){const error=new Error("Manage shared app access in DTM Hub.");error.statusCode=403;throw error;}
    return session;
  }
  const tokenHash = hashToken(token);
  const sessionDoc = await adminSessionCollection.doc(tokenHash).get();
  if (!sessionDoc.exists) {
    const error = new Error("Admin session expired.");
    error.statusCode = 401;
    throw error;
  }

  const session = sessionDoc.data();
  if (session.appId !== APP_ID) {
    const error = new Error("This admin screen is not available for that app.");
    error.statusCode = 403;
    throw error;
  }
  if (!session.expiresAt || session.expiresAt.toMillis() < Date.now()) {
    await sessionDoc.ref.delete();
    const error = new Error("Admin session expired.");
    error.statusCode = 401;
    throw error;
  }
  if (!allowedRoles.includes(session.role)) {
    const error = new Error("This admin account cannot perform that action.");
    error.statusCode = 403;
    throw error;
  }
  if (session.forcePasswordChange) {
    const error = new Error("Change your temporary password before continuing.");
    error.statusCode = 403;
    throw error;
  }
  return {...session, tokenHash};
}

async function drivewiseState(session) {
  const state = await readState();
  const progress=await mechanicProgress();
  const customerState=session.role==='recovery'?{accounts:{},notifications:null}:await customer.snapshot();
  return {
    ok: true,
    role: session.role,
    hubSession: Boolean(session.hub),
    accessLevels: session.roles || [session.role],
    username: session.username,
    title: "Downtown Ministries DriveWise",
    mainAdminUsername: state.adminCredentials?.username || "admin",
    regularAdmins: session.role === "full"
      ? (state.regularAdmins || []).map((adminRecord) => ({
        id: adminRecord.id,
        username: adminRecord.username,
        accessLevel: normalizeAccessLevel(adminRecord.accessLevel),
        createdAt: adminRecord.createdAt || "",
      }))
      : [],
    repairs: session.role === "recovery" ? [] : await enrichDrivewiseRepairs((state.repairs || []).map(repair=>({...repair,mechanic:progress.get(repair.id),customerAccount:customerState.accounts[repair.id]||null}))),
    workflow:await workflow.snapshot(),
    notificationSettings:session.role==='full'?customerState.notifications:null,
    paymentBatches: session.role === "recovery" ? [] : state.paymentBatches || [],
    adminLog: state.adminLog || [],
  };
}

async function enrichDrivewiseRepairs(repairs) {
  return Promise.all((repairs || []).map(async (repair) => ({
    ...repair,
    notesFile: repair.notesFile?.storagePath
      ? {
        ...repair.notesFile,
        url: await signedStorageUrl(repair.notesFile.storagePath, repair.notesFile.bucket),
      }
      : repair.notesFile || null,
    invoices: await Promise.all((repair.invoices || []).map(async (invoice) => ({
      ...invoice,
      invoiceFile: invoice.invoiceFile?.storagePath
        ? {
          ...invoice.invoiceFile,
          url: await signedStorageUrl(invoice.invoiceFile.storagePath, invoice.invoiceFile.bucket),
        }
        : invoice.invoiceFile || null,
    }))),
  })));
}

async function updateMainAdminAccount(request, session) {
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  if (!username) return {ok: false, error: "Enter a full-admin login name."};
  if (password && password.length < 6) return {ok: false, error: "New password must be at least 6 characters."};

  const state = await readState();
  state.adminCredentials = {
    ...state.adminCredentials,
    username,
    ...(password ? {passwordHash: hashPassword(password), forcePasswordChange: true} : {}),
  };
  logStateChange(
    state,
    session.username,
    "Update DriveWise full-admin account",
    password
      ? `${session.username} reset the DriveWise full-admin password.`
      : `${session.username} updated the DriveWise full-admin login name.`,
  );
  await writeState(state);
  return drivewiseState(session);
}

async function addRegularAdmin(request, session) {
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  const requestedAccessLevel = normalizeAccessLevel(request.body?.accessLevel);
  const accessLevel = ["admin", "schedule", "accounting"].includes(requestedAccessLevel)
    ? requestedAccessLevel
    : "admin";
  if (!username || !password) return {ok: false, error: "Enter a login name and password."};
  if (password.length < 6) return {ok: false, error: "Password must be at least 6 characters."};

  const state = await readState();
  const normalizedUsername = normalizeAdminLogin(username);
  const existingRegularAdmin = (state.regularAdmins || []).some((adminRecord) =>
    normalizeAdminLogin(adminRecord.username) === normalizedUsername,
  );
  if (
    normalizeAdminLogin(state.adminCredentials?.username) === normalizedUsername ||
    normalizeAdminLogin(state.recoveryAdminCredentials?.username) === normalizedUsername ||
    existingRegularAdmin
  ) {
    return {ok: false, error: "That login name is already in use."};
  }

  state.regularAdmins = [
    ...(state.regularAdmins || []),
    {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username,
      passwordHash: hashPassword(password),
      accessLevel,
      createdAt: new Date().toISOString(),
      forcePasswordChange: false,
    },
  ];
  logStateChange(state, session.username, "Add DriveWise admin account", `${session.username} added ${username} as ${accessLevel}.`);
  await writeState(state);
  return drivewiseState(session);
}

async function deleteRegularAdmin(request, session) {
  const adminId = clean(request.body?.id);
  const state = await readState();
  const target = (state.regularAdmins || []).find((adminRecord) => adminRecord.id === adminId);
  if (!target) return {ok: false, error: "Admin account was not found."};
  state.regularAdmins = state.regularAdmins.filter((adminRecord) => adminRecord.id !== adminId);
  logStateChange(state, session.username, "Delete DriveWise admin account", `${session.username} deleted admin account ${target.username}.`);
  await writeState(state);
  return drivewiseState(session);
}

async function saveDrivewiseRepair(request, session) {
  const state = await readState();
  let repair = sanitizeDrivewiseRepair(request.body?.repair || {});
  const original=(state.repairs || []).find(item=>item.id===repair.id);
  assertRepairEditable(original);
  if(repair.id&&!original?.correctionOpen)await customer.assertOpen(repair.id);
  repair=preserveInvoiceHistory(repair,original);
  if (repair.recordType === "shopSupply") {
    repair.ownerName = "Shop Supplies";
    repair.vehicleInfo = "Shop Supplies";
    repair.neededRepairs = repair.neededRepairs || "Shop supplies";
  }
  if (
    repair.recordType !== "shopSupply" &&
    (!repair.repairDate || !repair.ownerName || !repair.year || !repair.make || !repair.model || !repair.neededRepairs)
  ) {
    return {ok: false, error: "Repair date, owner name, year, make, model, and needed repairs are required."};
  }
  if (repair.recordType === "shopSupply" && !repair.repairDate) {
    return {ok: false, error: "Supply date is required."};
  }
  if(repair.recordType!=="shopSupply"&&!original&&!repair.payer)return {ok:false,error:'Payer is required.'};
  const initialCharge=request.body?.repair?.agreedCharge;
  if(repair.recordType!=="shopSupply"&&initialCharge!==undefined&&initialCharge!==null&&String(initialCharge).trim()!=='')customerCents(initialCharge);
  if ((repair.invoices || []).some((invoice) => clean(invoice.vendor).length === 1)) {
    return {ok: false, error: "Vendor names must be at least 2 characters."};
  }
  repair.invoices=repair.invoices.filter(invoice=>invoice.vendor||invoice.invoiceNumber||invoice.partDescription||invoice.cost||invoice.invoiceFile||invoice.fileData);
  if ((repair.recordType === "shopSupply" && !repair.invoices.length) || repair.invoices.some((invoice) => !invoice.invoiceFile && !invoice.fileData)) {
    return {ok: false, error: "Upload an invoice image or PDF for each invoice."};
  }
  const existingIndex = (state.repairs || []).findIndex((item) => item.id === repair.id);
  if (existingIndex >= 0 && !original.correctionOpen && repairHasCompletedStatement(state.repairs[existingIndex])) {
    return {ok: false, error: "This repair record has completed statement invoices and is view-only."};
  }

  try {
    repair.notesFile = await saveDrivewiseNotesFile(repair.id, repair);
    repair.invoices = await saveDrivewiseInvoiceFiles(repair.id, repair.invoices);
  } catch (error) {
    return {ok: false, error: error.message};
  }

  if(existingIndex<0&&repair.recordType!=="shopSupply")throw Object.assign(Error("Create a pending customer application first."),{statusCode:409});
  if(existingIndex>=0){
    await corrections.saveExisting(repair,request.body?.repair?.revision,initialCharge,session.username);
    return drivewiseState(session);
  }

  await corrections.createSupply(repair,session.username);
  return drivewiseState(session);
}

async function deleteDrivewiseRepair(request, session) {
  const repairId = clean(request.body?.id);
  const state = await readState();
  const repair = (state.repairs || []).find((item) => item.id === repairId);
  if (!repair) return {ok: false, error: "Repair record was not found."};
  if(repair.historicalComplete||repair.correctionHistory?.length||repair.invoiceTransfers?.length||repair.invoices?.some(i=>i.statementHistory?.length))throw Object.assign(Error('Records with historical or correction history cannot be deleted.'),{statusCode:409});
  assertRepairEditable(repair);
  await customer.assertDeletable(repairId);
  if (repairHasCompletedStatement(repair)) {
    return {ok: false, error: "This repair record has completed statement invoices and cannot be deleted."};
  }
  state.repairs = state.repairs.filter((item) => item.id !== repairId);
  logStateChange(state, session.username, "Delete DriveWise repair", `${session.username} deleted repair record for ${repair.ownerName}.`);
  await writeState(state);
  return drivewiseState(session);
}

async function updateDrivewiseInvoiceStatus(request, session) {
  await corrections.updateSelection(clean(request.body?.repairId),clean(request.body?.invoiceId),request.body?.updates||{},session.username);
  return drivewiseState(session);
}

async function updateDrivewiseInvoiceFile(request, session) {
  const repairId = clean(request.body?.repairId);
  const invoiceId = clean(request.body?.invoiceId);
  const fileName = clean(request.body?.fileName);
  const fileContentType = clean(request.body?.fileContentType);
  const fileData = clean(request.body?.fileData);
  if (!repairId || !invoiceId || !fileName || !fileContentType || !fileData) {
    return {ok: false, error: "Choose an invoice file to upload."};
  }

  const state = await readState();
  if(state.repairs.find(r=>r.id===repairId)?.invoices?.find(i=>i.id===invoiceId)?.statementComplete)throw Object.assign(Error('Reverse the completed invoice before replacing its attachment.'),{statusCode:409});
  const repair=state.repairs.find(r=>r.id===repairId),invoice=repair?.invoices?.find(i=>i.id===invoiceId);
  if(!invoice)return {ok:false,error:'Invoice was not found.'};
  const [stored]=await saveDrivewiseInvoiceFiles(repairId,[{...invoice,fileName,fileContentType,fileData}]);
  await corrections.attach(repairId,invoiceId,stored.invoiceFile,session.username);
  return drivewiseState(session);
}

async function uploadDrivewiseFile(request) {
  const repairId = clean(request.body?.repairId);
  const invoiceId = clean(request.body?.invoiceId);
  const fileKind = clean(request.body?.fileKind);
  const fileName = clean(request.body?.fileName);
  const fileContentType = clean(request.body?.fileContentType);
  const fileData = clean(request.body?.fileData);
  if (!repairId || !fileKind || !fileName || !fileContentType || !fileData) {
    return {ok: false, error: "Choose a file to upload."};
  }
  const existing=(await readState()).repairs.find(r=>r.id===repairId);
  if(fileKind==='invoice'&&existing?.invoices?.find(i=>i.id===invoiceId)?.statementComplete)throw Object.assign(Error('Reverse the completed invoice before replacing its attachment.'),{statusCode:409});
  try {
    if (fileKind === "notes") {
      const notesFile = await saveDrivewiseNotesFile(repairId, {
        notesFileName: fileName,
        notesFileContentType: fileContentType,
        notesFileData: fileData,
      });
      return {ok: true, notesFile};
    }
    if (fileKind === "invoice") {
      if (!invoiceId) return {ok: false, error: "Invoice id is required."};
      const [storedInvoice] = await saveDrivewiseInvoiceFiles(repairId, [{
        id: invoiceId,
        fileName,
        fileContentType,
        fileData,
      }]);
      return {ok: true, invoiceFile: storedInvoice.invoiceFile};
    }
    return {ok: false, error: "Unknown file upload type."};
  } catch (error) {
    return {ok: false, error: error.message};
  }
}

async function completeDrivewiseStatement(request, session) {
  await corrections.close(request.body||{},session.username);
  return drivewiseState(session);
}

async function purgeDrivewiseRepairData(session) {
  const state = await readState();
  const repairCount = (state.repairs || []).length;
  const invoiceCount = (state.repairs || []).reduce(
    (total, repair) => total + ((repair.invoices || []).length),
    0,
  );
  state.repairs = [];
  state.paymentBatches = [];
  logStateChange(
    state,
    session.username,
    "Purge DriveWise repair data",
    `${session.username} purged ${repairCount} repair record(s) and ${invoiceCount} invoice(s).`,
  );
  await writeState(state);
  return drivewiseState(session);
}

async function downloadDrivewiseInvoiceFile(request, response) {
  const path = clean(request.query?.path);
  const requestedBucket = clean(request.query?.bucket);
  const name = clean(request.query?.name) || "invoice";
  if (!path || !path.startsWith("drivewiseInvoices/")) {
    sendJson(response, 400, {error: "Invoice file path is required."});
    return;
  }
  const bucketNames = requestedBucket ? [requestedBucket] : storageBucketNames;
  let lastError = null;
  for (const bucketName of bucketNames) {
    try {
      const file = storage.bucket(bucketName).file(path);
      const [metadata] = await file.getMetadata();
      const [buffer] = await file.download();
      response
        .status(200)
        .set("Cache-Control", "private, max-age=0, no-store")
        .set("Content-Type", metadata.contentType || "application/octet-stream")
        .set("Content-Disposition", `inline; filename="${sanitizeHeaderFilename(name)}"`)
        .send(buffer);
      return;
    } catch (error) {
      lastError = error;
      if (!isMissingBucketError(error)) break;
    }
  }
  logger.warn("Could not download DriveWise invoice file", {path, bucket: requestedBucket, error: lastError?.message});
  sendJson(response, 404, {error: "Invoice file was not found."});
}

async function createDrivewisePaymentBatch(request, session) {
  const vendor = normalizeVendorName(request.body?.vendor);
  if (!vendor) return {ok: false, error: "Choose a vendor to create a payment batch."};
  const state = await readState();
  const batchId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const invoices = [];
  let total = 0;

  state.repairs = (state.repairs || []).map((repair) => ({
    ...repair,
    invoices: (repair.invoices || []).map((invoice) => {
      if (normalizeEmail(invoice.vendor) !== normalizeEmail(vendor) || invoice.paid) return invoice;
      const next = {
        ...invoice,
        paid: true,
        paidAt: new Date().toISOString(),
        paymentBatchId: batchId,
      };
      total += next.cost || 0;
      invoices.push({
        repairId: repair.id,
        ownerName: repair.ownerName,
        vehicleInfo: repair.vehicleInfo,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partDescription: invoice.partDescription,
        cost: invoice.cost,
      });
      return next;
    }),
  }));

  if (!invoices.length) return {ok: false, error: "No unpaid invoices were found for that vendor."};
  state.paymentBatches = [
    {
      id: batchId,
      vendor,
      createdAt: new Date().toISOString(),
      createdBy: session.username,
      total,
      invoices,
    },
    ...(state.paymentBatches || []),
  ];
  logStateChange(state, session.username, "Create DriveWise payment batch", `${session.username} marked ${invoices.length} ${vendor} invoice(s) paid.`);
  await writeState(state);
  return drivewiseState(session);
}

function sanitizeDrivewiseRepair(input) {
  const invoices = Array.isArray(input.invoices) ? input.invoices : [];
  const year = clean(input.year);
  const make = clean(input.make);
  const model = clean(input.model);
  const id = clean(input.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const recordType = clean(input.recordType) === "shopSupply" ? "shopSupply" : "repair";
  return {
    id,
    recordType,
    createdAt: clean(input.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repairDate: clean(input.repairDate),
    ownerName: clean(input.ownerName),
    ...require("./intake-domain").vehicleIdentifiers(input),
    year,
    make,
    model,
    vehicleInfo: [year, make, model].filter(Boolean).join(" ") || clean(input.vehicleInfo),
    vehicleTrackingId: clean(input.vehicleTrackingId) || id,
    payer: clean(input.payer),
    neededRepairs: clean(input.neededRepairs),
    status: clean(input.status) || "Open",
    notes: clean(input.notes),
    notesFileName: clean(input.notesFileName),
    notesFileContentType: clean(input.notesFileContentType),
    notesFileData: clean(input.notesFileData),
    notesFile: input.notesFile && typeof input.notesFile === "object" ? {
      name: clean(input.notesFile.name),
      contentType: clean(input.notesFile.contentType),
      storagePath: clean(input.notesFile.storagePath),
      bucket: clean(input.notesFile.bucket),
    } : null,
    invoices: invoices.map((invoice) => ({
      id: clean(invoice.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      vendor: normalizeVendorName(invoice.vendor),
      invoiceNumber: clean(invoice.invoiceNumber),
      partDescription: clean(invoice.partDescription),
      cost: Number.parseFloat(invoice.cost) || 0,
      fileName: clean(invoice.fileName),
      fileContentType: clean(invoice.fileContentType),
      fileData: clean(invoice.fileData),
      invoiceFile: invoice.invoiceFile && typeof invoice.invoiceFile === "object" ? {
        name: clean(invoice.invoiceFile.name),
        contentType: clean(invoice.invoiceFile.contentType),
        storagePath: clean(invoice.invoiceFile.storagePath),
        bucket: clean(invoice.invoiceFile.bucket),
      } : null,
      statementChecked: Boolean(invoice.statementChecked),
      paid: Boolean(invoice.paid),
      paidAt: clean(invoice.paidAt),
      paymentBatchId: clean(invoice.paymentBatchId),
      statementComplete: Boolean(invoice.statementComplete),
      statementCompletedAt: clean(invoice.statementCompletedAt),
      statementCompletedBy: clean(invoice.statementCompletedBy),
    })),
  };
}

function repairHasCompletedStatement(repair) {
  return (repair.invoices || []).some((invoice) => invoice.statementComplete);
}

async function saveDrivewiseNotesFile(repairId, repair) {
  if (!repair.notesFileData) {
    delete repair.notesFileData;
    delete repair.notesFileContentType;
    delete repair.notesFileName;
    return repair.notesFile || null;
  }
  if (!["image/jpeg", "image/png", "application/pdf"].includes(repair.notesFileContentType)) {
    throw new Error("Notes files need to be JPG, PNG, or PDF.");
  }
  const buffer = Buffer.from(repair.notesFileData, "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
    throw new Error("Notes files must be smaller than 10 MB.");
  }
  const fileName = repair.notesFileName || "Notes attachment";
  const contentType = repair.notesFileContentType;
  const extension = repair.notesFileContentType === "application/pdf"
    ? "pdf"
    : repair.notesFileContentType === "image/png" ? "png" : "jpg";
  const storagePath = `drivewiseInvoices/${repairId}/notes-attachment.${extension}`;
  const bucketName = await saveInvoiceBufferToStorage(storagePath, buffer, contentType);
  delete repair.notesFileData;
  delete repair.notesFileContentType;
  delete repair.notesFileName;
  return {
    name: fileName,
    contentType,
    storagePath,
    bucket: bucketName,
  };
}

async function saveDrivewiseInvoiceFiles(repairId, invoices) {
  return Promise.all(invoices.map(async (invoice, index) => {
    if (!invoice.fileData) {
      const storedInvoice = {...invoice};
      delete storedInvoice.fileData;
      delete storedInvoice.fileContentType;
      delete storedInvoice.fileName;
      return storedInvoice;
    }
    if (!["image/jpeg", "image/png", "application/pdf"].includes(invoice.fileContentType)) {
      throw new Error("Invoice files need to be JPG, PNG, or PDF.");
    }
    const buffer = Buffer.from(invoice.fileData, "base64");
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
      throw new Error("Invoice files must be smaller than 10 MB.");
    }
    const extension = invoice.fileContentType === "application/pdf"
      ? "pdf"
      : invoice.fileContentType === "image/png" ? "png" : "jpg";
    const storagePath = `drivewiseInvoices/${repairId}/${invoice.id || `invoice-${index + 1}`}-${crypto.randomUUID()}.${extension}`;
    const bucketName = await saveInvoiceBufferToStorage(storagePath, buffer, invoice.fileContentType);
    const storedInvoice = {...invoice};
    delete storedInvoice.fileData;
    delete storedInvoice.fileContentType;
    delete storedInvoice.fileName;
    return {
      ...storedInvoice,
      invoiceFile: {
        name: invoice.fileName || `Invoice ${index + 1}`,
        contentType: invoice.fileContentType,
        storagePath,
        bucket: bucketName,
      },
    };
  }));
}

async function saveInvoiceBufferToStorage(storagePath, buffer, contentType) {
  let lastError = null;
  for (const bucketName of storageBucketNames) {
    try {
      await storage.bucket(bucketName).file(storagePath).save(buffer, {
        contentType,
        metadata: {
          cacheControl: "private, max-age=0, no-transform",
        },
      });
      return bucketName;
    } catch (error) {
      lastError = error;
      if (!isMissingBucketError(error)) throw error;
    }
  }
  throw new Error(
    "Firebase Storage is not set up for this project. Open Firebase Storage in the console and click Get started, then try saving again.",
    {cause: lastError},
  );
}

async function signedStorageUrl(path, bucketName = "") {
  if (!path) return "";
  const bucketNames = bucketName ? [bucketName] : storageBucketNames;
  for (const candidateBucketName of bucketNames) {
    try {
      const [url] = await storage.bucket(candidateBucketName).file(path).getSignedUrl({
        action: "read",
        expires: Date.now() + 60 * 60 * 1000,
      });
      return url;
    } catch (error) {
      logger.warn("Could not create DriveWise invoice URL", {path, bucket: candidateBucketName, error: error.message});
    }
  }
  return "";
}

function isMissingBucketError(error) {
  return error?.code === 404 || /bucket does not exist|not found/i.test(error?.message || "");
}

function sanitizeHeaderFilename(value) {
  return clean(value).replace(/[^\w.\- ]/g, "_") || "invoice";
}

function logStateChange(state, actor, action, details) {
  state.adminLog = Array.isArray(state.adminLog) ? state.adminLog : [];
  state.adminLog.unshift({
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${state.adminLog.length}`,
    createdAt: new Date().toISOString(),
    actor,
    action,
    details,
  });
  state.adminLog = state.adminLog.slice(0, 250);
}

function routePath(request) {
  const path = request.path || "";
  return path.replace(/^\/api/, "") || "/";
}

exports.drivewiseApi = onRequest({cors: true, invoker: "public",timeoutSeconds:120}, async (request, response) => {
  try {
    const path = routePath(request);
    if(path==='/workflow/document'&&request.method==='GET'){
      await requireAdmin(request,['full','admin','schedule','accounting']);
      const bytes=await require('node:fs/promises').readFile(require('node:path').join(__dirname,'assets','DriveWise Workflow.docx'));
      response.set('Cache-Control','private, no-store').set('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document').set('Content-Disposition','attachment; filename="DriveWise Workflow.docx"').send(bytes);return;
    }
    if(path==='/application/start'&&request.method==='GET'){
      const ip=hashToken(request.ip||'unknown'),hour=Math.floor(Date.now()/3600000),rate=db.collection('applicationRate').doc(ip+'-'+hour);
      await db.runTransaction(async tx=>{const row=await tx.get(rate);if((row.data()?.count||0)>=12)throw Object.assign(Error('Please try again later or contact DTM.'),{statusCode:429});tx.set(rate,{count:(row.data()?.count||0)+1,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+86400000)});});
      const challenge=crypto.randomBytes(32).toString('hex');await db.collection('applicationChallenges').doc(hashToken(challenge)).create({ip,createdAt:Date.now(),expiresAt:Date.now()+3600000});sendJson(response,200,{challenge});return;
    }
    if(path==='/application/submit'&&request.method==='POST'){
      if(!['https://drivewise.web.app','https://downtownmin.org','https://www.downtownmin.org'].includes(request.get('origin')))throw Object.assign(Error('Open the DTM application form directly.'),{statusCode:403});
      const input=request.body||{};if(input.website||!/^[a-f0-9]{64}$/.test(input.challenge||''))throw Object.assign(Error('Please reopen the application form.'),{statusCode:400});
      const ref=db.collection('applicationChallenges').doc(hashToken(input.challenge));
      await db.runTransaction(async tx=>{const row=await tx.get(ref),value=row.data();if(!value||value.ip!==hashToken(request.ip||'unknown')||value.expiresAt<Date.now()||value.createdAt>Date.now()-2000||(value.operationId&&value.operationId!==input.operationId))throw Object.assign(Error('This application session expired. Reopen the form.'),{statusCode:400});tx.update(ref,{operationId:input.operationId});});
      await readState();await workflow.submitApplication(input,'Website application');sendJson(response,200,{ok:true});return;
    }

    if(request.method==='POST'&&path==='/workflow/decision-email'){
      const session=await requireAdmin(request,['full','admin','schedule']);await workflow.decisionEmail(clean(request.body?.repairId),request.body||{},session.username);await workflow.flush(2);sendJson(response,200,await drivewiseState(session));return;
    }
    if(request.method==='POST'&&path==='/workflow/complete-diagnostic'){
      const session=await requireAdmin(request,['full','admin','schedule']);await workflow.completeDiagnostic(clean(request.body?.repairId),request.body||{},session.username);await customer.flush(1);sendJson(response,200,await drivewiseState(session));return;
    }
    if(request.method==='POST'&&path==='/workflow/settings'){
      const session=await requireAdmin(request,['full']);await workflow.settings(request.body||{},session.username);sendJson(response,200,await drivewiseState(session));return;
    }
    if(request.method==='POST'&&path==='/workflow/digest'){
      await requireAdmin(request,['full']);const result=await workflow.digest(request.body?.date);const delivery=await workflow.flush(1);sendJson(response,200,{ok:true,...result,...delivery});return;
    }
    if(request.method==='GET'&&path==='/workflow/pdf'){
      await requireAdmin(request,['full','admin','schedule','accounting']);response.set('Content-Type','application/pdf').set('Content-Disposition','attachment; filename="DTM-diagnostic.pdf"').send(await workflow.pdf(clean(request.query?.repairId)));return;
    }
    if(request.method==='POST'&&['/workflow/create','/workflow/edit','/workflow/review','/workflow/schedule','/workflow/diagnostic','/workflow/activate'].includes(path)){
      const session=await requireAdmin(request,['full','admin','schedule']),input=request.body||{},action=path.split('/').pop();
      if(action==='create')await workflow.create(input,session.username);else await workflow[action](clean(input.repairId),input,session.username);
      await workflow.flush(2);sendJson(response,200,await drivewiseState(session));return;
    }

    if(request.method==='GET'&&path==='/drivewise-service-metrics'){
      const token=request.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      if(!await verifyMetricsCaller(token)){sendJson(response,403,{error:'DTM reporting service identity required.'});return;}
      const [state,work]=await Promise.all([readState(),mechanicWork.get()]);
      sendJson(response,200,drivewiseMetrics(state.repairs,new Map(work.docs.map(doc=>[doc.id,doc.data()])),request.query.from,request.query.through));return;
    }
    if(request.method==='POST'&&path==='/drivewise-move-invoice'){
      const session=await requireAdmin(request,['full','admin','schedule','accounting']);
      if(request.body?.kind==='invoice'&&session.role==='schedule')throw Object.assign(Error('Accounting access is required to move an accounting invoice.'),{statusCode:403});
      await moveInvoice(request.body||{},session.username);sendJson(response,200,await drivewiseState(session));return;
    }
    if(request.method==='POST'&&path==='/drivewise-reopen-repair'){
      const session=await requireAdmin(request,['full','admin','schedule']);
      await corrections.reopen(clean(request.body?.repairId),request.body||{},session.username);
      sendJson(response,200,await drivewiseState(session));return;
    }
    if(request.method==='POST'&&path==='/drivewise-reverse-invoice'){
      const session=await requireAdmin(request,['full','admin','accounting']);
      await corrections.reverse(clean(request.body?.repairId),clean(request.body?.invoiceId),request.body||{},session.username);
      sendJson(response,200,await drivewiseState(session));return;
    }
    if(request.method==='POST'&&['/mechanic/view','/mechanic/update','/mechanic/upload'].includes(path)){
      if(request.get('origin')!=='https://drivewise.web.app'){sendJson(response,403,{error:'Open the mechanic link directly.'});return;}
      const data=request.body||{};const result=path==='/mechanic/view'?await mechanic.view(data.token):path==='/mechanic/update'?await mechanic.update(data.token,data):await mechanic.upload(data.token,data);
      if(path==='/mechanic/update'&&data.complete===true)await customer.flush(1);
      sendJson(response,200,result);return;
    }
    if(request.method==='POST'&&path==='/drivewise-customer-account') {
      const session=await requireAdmin(request,['full','admin','schedule','accounting']);
      if(request.body?.action==='void'&&!['full','admin','accounting'].includes(session.role))throw Object.assign(Error('Accounting access is required to reverse a payment.'),{statusCode:403});
      const account=await customer.mutateAccount(clean(request.body?.repairId),request.body||{},session.username);
      await customer.flush(1);sendJson(response,200,{ok:true,account});return;
    }
    if(request.method==='POST'&&path==='/drivewise-notification-settings') {
      const session=await requireAdmin(request,['full']);
      const recipients=await customer.saveSettings(request.body?.recipients,session.username);sendJson(response,200,{ok:true,recipients});return;
    }
    if(request.method==='POST'&&path==='/drivewise-notification-retry') {
      await requireAdmin(request,['full']);await customer.retry();sendJson(response,200,{ok:true,...await customer.flush(5)});return;
    }
    if(request.method==='POST'&&['/drivewise-mechanic-share','/drivewise-mechanic-revoke'].includes(path)){
      const session=await requireAdmin(request,['full','admin','schedule']);
      const id=clean(request.body?.repairId);if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id)){sendJson(response,400,{error:'Choose a vehicle repair.'});return;}
      if(path.endsWith('-share')){const current=(await readState()).repairs.find(r=>r.id===id);if(current?.workflowStatus!=='live')throw Object.assign(Error('Make the work order live and choose a mechanic in Applications and diagnostics.'),{statusCode:409});await customer.assertOpen(id);}
      const result=path.endsWith('-share')?await mechanic.issue(id,session.username):await mechanic.revoke(id);sendJson(response,200,result);return;
    }


    if(request.method==="POST"&&path==="/dtm-access/hub/redeem"){
      if(request.get("origin")!=="https://drivewise.web.app"){sendJson(response,403,{error:"Open DriveWise from DTM Hub."});return;}
      const result=await fetch("https://dtmapp.web.app/api/dtm-access/hub/redeem",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://drivewise.web.app"},body:JSON.stringify({...request.body,app:"drivewise"}),signal:AbortSignal.timeout(15000)});
      sendJson(response,result.status,await result.json());return;
    }
    if(request.method==="GET"&&path==="/"){sendJson(response,200,{app:APP_ID,ok:true});return;}
    if(request.method==="GET"&&path==="/state"){
      const session=await requireAdmin(request,["full","admin","schedule","accounting","recovery"]);
      sendJson(response,200,await drivewiseState(session));return;
    }

    if (request.method === "POST" && path === "/admin-login") {
      const result = await adminLogin(request);
      sendJson(response, result.ok ? 200 : 401, result);
      return;
    }

    if (request.method === "GET" && path === "/drivewise-state") {
      const session = await requireAdmin(request, ["full", "admin", "schedule", "accounting", "recovery"]);
      sendJson(response, 200, await drivewiseState(session));
      return;
    }

    if (request.method === "GET" && path === "/drivewise-invoice-download") {
      await requireAdmin(request, ["full", "admin", "schedule", "accounting"]);
      await downloadDrivewiseInvoiceFile(request, response);
      return;
    }

    if (request.method === "POST" && path === "/admin-main-account") {
      const session = await requireAdmin(request, ["full", "recovery"]);
      const result = await updateMainAdminAccount(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-regular-admins") {
      const session = await requireAdmin(request, ["full"]);
      const result = await addRegularAdmin(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-delete-regular-admin") {
      const session = await requireAdmin(request, ["full"]);
      const result = await deleteRegularAdmin(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-repair") {
      const session = await requireAdmin(request, ["full", "admin", "schedule"]);
      const result = await saveDrivewiseRepair(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-delete-repair") {
      const session = await requireAdmin(request, ["full", "accounting"]);
      const result = await deleteDrivewiseRepair(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-invoice-status") {
      const session = await requireAdmin(request, ["full", "admin", "accounting"]);
      const result = await updateDrivewiseInvoiceStatus(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-invoice-file") {
      const session = await requireAdmin(request, ["full", "admin", "accounting", "schedule"]);
      const result = await updateDrivewiseInvoiceFile(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-file-upload") {
      await requireAdmin(request, ["full", "admin", "schedule"]);
      const result = await uploadDrivewiseFile(request);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-complete-statement") {
      const session = await requireAdmin(request, ["full", "admin", "accounting"]);
      const result = await completeDrivewiseStatement(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-purge-repairs") {
      const session = await requireAdmin(request, ["full", "recovery"]);
      sendJson(response, 200, await purgeDrivewiseRepairData(session));
      return;
    }

    if (request.method === "POST" && path === "/drivewise-payment-batch") {
      const session = await requireAdmin(request, ["full", "admin", "accounting"]);
      const result = await createDrivewisePaymentBatch(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    sendJson(response, 404, {error: "Unknown API route."});
  } catch (error) {
    logger.error("API request failed", error);
    sendJson(response, error.statusCode || 500, {error: error.statusCode ? error.message : "Server error."});
  }
});

exports.drivewiseNotificationRetry=onSchedule({schedule:'every 15 minutes',region:'us-central1',maxInstances:1,timeoutSeconds:540},async()=>{
  await workflow.flush(5);
  const result=await customer.flush(5);
  if(result.attempted>result.sent)logger.warn('DriveWise notification delivery remains pending.',result);
});

function sendJson(response, status, body) {
  response.status(status).set("Cache-Control", "no-store").json(body);
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeVendorName(value) {
  const vendor = clean(value);
  const normalized = vendor.toLowerCase();
  if (normalized === "federated" || normalized === "federated auto") return "Federated Auto";
  return vendor;
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizeDrivewiseRepairVendors(repair) {
  return {
    ...(repair || {}),
    invoices: Array.isArray(repair?.invoices)
      ? repair.invoices.map((invoice) => ({
        ...invoice,
        vendor: normalizeVendorName(invoice.vendor),
      }))
      : [],
  };
}

function normalizeAdminLogin(value) {
  return clean(value).toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(`fair-volunteer-password-v1|${clean(password)}`).digest("hex");
}

function normalizeCredentialRecord(record) {
  const next = {...(record || {})};
  if (!next.passwordHash && next.password) {
    next.passwordHash = hashPassword(next.password);
  }
  delete next.password;
  return next;
}

function credentialMatches(record, passwordHash, plainPassword = "") {
  return Boolean(
    (record?.passwordHash && record.passwordHash === passwordHash)
    || (!record?.passwordHash && record?.password && record.password === plainPassword)
  );
}

exports.drivewiseDiagnosticDigest=onSchedule({schedule:"0 16 * * 5",timeZone:"America/Indiana/Indianapolis",region:"us-central1",maxInstances:1},async()=>{await workflow.digest();await workflow.flush(1);});
