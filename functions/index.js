const admin = require("firebase-admin");
const crypto = require("crypto");
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

admin.initializeApp();
setGlobalOptions({maxInstances: 10});

const db = admin.firestore();
const APP_ID = "drivewise";
const adminSessionCollection = db.collection("adminSessions");

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
    repairs: Array.isArray(source.repairs) ? source.repairs : [],
    paymentBatches: Array.isArray(source.paymentBatches) ? source.paymentBatches : [],
    adminLog: Array.isArray(source.adminLog) ? source.adminLog : [],
    adminCredentials: normalizeCredentialRecord(source.adminCredentials || defaultState().adminCredentials),
    recoveryAdminCredentials: normalizeCredentialRecord(source.recoveryAdminCredentials || defaultState().recoveryAdminCredentials),
    regularAdmins: Array.isArray(source.regularAdmins)
      ? source.regularAdmins.map((record) => ({
        ...normalizeCredentialRecord(record),
        accessLevel: ["full", "schedule", "accounting"].includes(record?.accessLevel) ? record.accessLevel : "schedule",
      }))
      : [],
  };
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
      role = ["full", "schedule", "accounting"].includes(regularAdmin.accessLevel)
        ? regularAdmin.accessLevel
        : "schedule";
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
  const token = clean((request.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  if (!token) {
    const error = new Error("Admin login required.");
    error.statusCode = 401;
    throw error;
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
  return {
    ok: true,
    role: session.role,
    username: session.username,
    title: "Downtown Ministries DriveWise",
    mainAdminUsername: state.adminCredentials?.username || "admin",
    repairs: session.role === "recovery" ? [] : state.repairs || [],
    paymentBatches: session.role === "recovery" ? [] : state.paymentBatches || [],
    adminLog: state.adminLog || [],
  };
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

async function saveDrivewiseRepair(request, session) {
  const state = await readState();
  const repair = sanitizeDrivewiseRepair(request.body?.repair || {});
  if (!repair.ownerName || !repair.vehicleInfo) {
    return {ok: false, error: "Owner name and vehicle information are required."};
  }

  const existingIndex = (state.repairs || []).findIndex((item) => item.id === repair.id);
  if (existingIndex >= 0) {
    state.repairs[existingIndex] = {
      ...state.repairs[existingIndex],
      ...repair,
      updatedAt: new Date().toISOString(),
    };
  } else {
    state.repairs = [
      repair,
      ...(state.repairs || []),
    ];
  }

  logStateChange(
    state,
    session.username,
    existingIndex >= 0 ? "Update DriveWise repair" : "Add DriveWise repair",
    `${session.username} saved repair record for ${repair.ownerName}.`,
  );
  await writeState(state);
  return drivewiseState(session);
}

async function deleteDrivewiseRepair(request, session) {
  const repairId = clean(request.body?.id);
  const state = await readState();
  const repair = (state.repairs || []).find((item) => item.id === repairId);
  if (!repair) return {ok: false, error: "Repair record was not found."};
  state.repairs = state.repairs.filter((item) => item.id !== repairId);
  logStateChange(state, session.username, "Delete DriveWise repair", `${session.username} deleted repair record for ${repair.ownerName}.`);
  await writeState(state);
  return drivewiseState(session);
}

async function updateDrivewiseInvoiceStatus(request, session) {
  const repairId = clean(request.body?.repairId);
  const invoiceId = clean(request.body?.invoiceId);
  const updates = request.body?.updates || {};
  const state = await readState();
  let changed = false;
  state.repairs = (state.repairs || []).map((repair) => {
    if (repair.id !== repairId) return repair;
    return {
      ...repair,
      invoices: (repair.invoices || []).map((invoice) => {
        if (invoice.id !== invoiceId) return invoice;
        changed = true;
        return {
          ...invoice,
          statementChecked: updates.statementChecked === undefined ? invoice.statementChecked : Boolean(updates.statementChecked),
          paid: updates.paid === undefined ? invoice.paid : Boolean(updates.paid),
          paidAt: updates.paid ? new Date().toISOString() : clean(updates.paidAt || invoice.paidAt),
        };
      }),
    };
  });
  if (!changed) return {ok: false, error: "Invoice was not found."};
  logStateChange(state, session.username, "Update DriveWise invoice", `${session.username} updated invoice status.`);
  await writeState(state);
  return drivewiseState(session);
}

async function createDrivewisePaymentBatch(request, session) {
  const vendor = clean(request.body?.vendor);
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
  return {
    id: clean(input.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: clean(input.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repairDate: clean(input.repairDate),
    ownerName: clean(input.ownerName),
    vehicleInfo: clean(input.vehicleInfo),
    neededRepairs: clean(input.neededRepairs),
    status: clean(input.status) || "Open",
    notes: clean(input.notes),
    invoices: invoices.map((invoice) => ({
      id: clean(invoice.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      vendor: clean(invoice.vendor),
      invoiceNumber: clean(invoice.invoiceNumber),
      partDescription: clean(invoice.partDescription),
      cost: Math.max(0, Number.parseFloat(invoice.cost) || 0),
      statementChecked: Boolean(invoice.statementChecked),
      paid: Boolean(invoice.paid),
      paidAt: clean(invoice.paidAt),
      paymentBatchId: clean(invoice.paymentBatchId),
    })),
  };
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

exports.drivewiseApi = onRequest({cors: true, invoker: "public"}, async (request, response) => {
  try {
    const path = routePath(request);

    if (request.method === "GET" && (path === "/state" || path === "/")) {
      sendJson(response, 200, {state: await readState(), app: APP_ID});
      return;
    }

    if (request.method === "POST" && path === "/admin-login") {
      const result = await adminLogin(request);
      sendJson(response, result.ok ? 200 : 401, result);
      return;
    }

    if (request.method === "GET" && path === "/drivewise-state") {
      const session = await requireAdmin(request, ["full", "schedule", "accounting", "recovery"]);
      sendJson(response, 200, await drivewiseState(session));
      return;
    }

    if (request.method === "POST" && path === "/admin-main-account") {
      const session = await requireAdmin(request, ["full", "recovery"]);
      const result = await updateMainAdminAccount(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-repair") {
      const session = await requireAdmin(request, ["full", "schedule"]);
      const result = await saveDrivewiseRepair(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-delete-repair") {
      const session = await requireAdmin(request, ["full", "schedule"]);
      const result = await deleteDrivewiseRepair(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-invoice-status") {
      const session = await requireAdmin(request, ["full", "accounting"]);
      const result = await updateDrivewiseInvoiceStatus(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-payment-batch") {
      const session = await requireAdmin(request, ["full", "accounting"]);
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

function sendJson(response, status, body) {
  response.status(status).set("Cache-Control", "no-store").json(body);
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
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
