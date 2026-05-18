const admin = require("firebase-admin");
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const {setGlobalOptions} = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");

admin.initializeApp();
setGlobalOptions({maxInstances: 10});

const db = admin.firestore();
const storage = admin.storage();
const storageBucketName = process.env.STORAGE_BUCKET || "dtmcleaners.appspot.com";
const SUPPORTED_APP_IDS = new Set(["current", "ticketScanning", "gideonBooth", "mealSignup", "drivewise"]);
const passwordResetCollection = db.collection("passwordResets");
const changeLinkCollection = db.collection("changeLinks");
const adminSessionCollection = db.collection("adminSessions");
const postmarkServerToken = defineSecret("POSTMARK_SERVER_TOKEN");
const postmarkFromEmail = defineSecret("POSTMARK_FROM_EMAIL");
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioFromNumber = defineSecret("TWILIO_FROM_NUMBER");
const providerSecrets = [
  postmarkServerToken,
  postmarkFromEmail,
  twilioAccountSid,
  twilioAuthToken,
  twilioFromNumber,
];
const DEFAULT_CHANGE_CONTACT = {
  name: "Mike Groff",
  email: "cropwatch87@gmail.com",
  phone: "574-202-3312",
};

  const DEFAULT_EMAIL_TEMPLATES = {
    confirmation: {
      subject: "Elkhart County Fair restroom cleaning signup confirmation",
    body: "{name}, thank you for volunteering with the Elkhart County Fair restroom cleaning team on {date} from {shift}. We appreciate your help.{sharedContactNote} Your volunteer login name is {login}.",
  },
  "two-week-reminder": {
    subject: "Reminder: restroom cleaning shift in two weeks",
    body: "{name}, this is your two-week reminder for the Elkhart County Fair restroom cleaning team on {date} from {shift}.{sharedContactNote} Your volunteer login name is {login}.",
  },
  "day-before-reminder": {
    subject: "Reminder: restroom cleaning shift tomorrow",
    body: "{name}, this is your day-before reminder for the Elkhart County Fair restroom cleaning team on {date} from {shift}.{sharedContactNote} Your volunteer login name is {login}.",
  },
};

const DEFAULT_SMS_TEMPLATES = {
  confirmation: "{name}, thank you for volunteering for Elkhart County Fair restroom cleaning on {date} from {shift}. Reply STOP to opt out or HELP for help.",
  "two-week-reminder": "{name}, reminder: your restroom cleaning volunteer shift is in two weeks on {date} from {shift}. Reply STOP to opt out or HELP for help.",
  "day-before-reminder": "{name}, reminder: your restroom cleaning volunteer shift is tomorrow, {date}, from {shift}. Reply STOP to opt out or HELP for help.",
};

const TICKET_EMAIL_TEMPLATES = {
  confirmation: {
    subject: "Elkhart County Fair ticket scanning signup confirmation",
    body: "{name}, thank you for volunteering with the Elkhart County Fair ticket scanning team on {date} from {shift}. We appreciate your help.{sharedContactNote} Your volunteer login name is {login}.",
  },
  "two-week-reminder": {
    subject: "Reminder: ticket scanning shift in two weeks",
    body: "{name}, this is your two-week reminder for the Elkhart County Fair ticket scanning team on {date} from {shift}.{sharedContactNote} Your volunteer login name is {login}.",
  },
  "day-before-reminder": {
    subject: "Reminder: ticket scanning shift tomorrow",
    body: "{name}, this is your day-before reminder for the Elkhart County Fair ticket scanning team on {date} from {shift}.{sharedContactNote} Your volunteer login name is {login}.",
  },
};

const TICKET_SMS_TEMPLATES = {
  confirmation: "{name}, thank you for volunteering for Elkhart County Fair ticket scanning on {date} from {shift}. Reply STOP to opt out or HELP for help.",
  "two-week-reminder": "{name}, reminder: your ticket scanning volunteer shift is in two weeks on {date} from {shift}. Reply STOP to opt out or HELP for help.",
  "day-before-reminder": "{name}, reminder: your ticket scanning volunteer shift is tomorrow, {date}, from {shift}. Reply STOP to opt out or HELP for help.",
};

const GIDEON_EMAIL_TEMPLATES = {
  confirmation: {
    subject: "Elkhart County Fair Gideon Booth signup confirmation",
    body: "{name}, thank you for volunteering at the Elkhart County Fair Gideon Booth on {date} from {shift}. We appreciate your help.{sharedContactNote}",
  },
  "two-week-reminder": {
    subject: "Reminder: Gideon Booth shift in two weeks",
    body: "{name}, this is your two-week reminder for the Elkhart County Fair Gideon Booth on {date} from {shift}.{sharedContactNote}",
  },
  "day-before-reminder": {
    subject: "Reminder: Gideon Booth shift tomorrow",
    body: "{name}, this is your day-before reminder for the Elkhart County Fair Gideon Booth on {date} from {shift}.{sharedContactNote}",
  },
};

const GIDEON_SMS_TEMPLATES = {
  confirmation: "Downtown Ministries: {name}, thank you for volunteering at the Elkhart County Fair Gideon Booth on {date} from {shift}. Reply STOP to opt out or HELP for help.",
  "two-week-reminder": "Downtown Ministries reminder: {name}, your Gideon Booth volunteer shift is in two weeks on {date} from {shift}. Reply STOP to opt out or HELP for help.",
  "day-before-reminder": "Downtown Ministries reminder: {name}, your Gideon Booth volunteer shift is tomorrow, {date}, from {shift}. Reply STOP to opt out or HELP for help.",
};

const MEAL_EMAIL_TEMPLATES = {
  confirmation: {
    subject: "Downtown Ministries meal signup confirmation",
    body: "{name}, thank you for providing a meal for {location} on {date}. Please drop off by {time}. Plan for about {servingSize} people. Meal: {meal}.",
  },
  "one-week-reminder": {
    subject: "Reminder: Downtown Ministries meal next week",
    body: "{name}, this is a one-week reminder for your Downtown Ministries meal at {location} on {date}. Please drop off by {time}. Plan for about {servingSize} people. Meal: {meal}.",
  },
  "day-before-reminder": {
    subject: "Reminder: Downtown Ministries meal tomorrow",
    body: "{name}, this is your day-before reminder for your Downtown Ministries meal at {location} tomorrow. Please drop off by {time}. Plan for about {servingSize} people. Meal: {meal}.",
  },
};

const MEAL_SMS_TEMPLATES = {
  confirmation: "Downtown Ministries: {name}, thank you for providing a meal at {location} on {date}. Drop off by {time}. Reply STOP to opt out or HELP for help.",
  "one-week-reminder": "Downtown Ministries reminder: your meal at {location} is in one week on {date}. Drop off by {time}. Reply STOP to opt out or HELP for help.",
  "day-before-reminder": "Downtown Ministries reminder: your meal at {location} is tomorrow. Drop off by {time}. Reply STOP to opt out or HELP for help.",
};

function defaultState(appId = "current") {
  const ticketScanning = appId === "ticketScanning";
  const gideonBooth = appId === "gideonBooth";
  const mealSignup = appId === "mealSignup";
  const drivewise = appId === "drivewise";
  return {
    volunteers: [],
    signups: [],
    emails: [],
    textMessages: [],
    emailTemplates: emailTemplatesFor(appId),
    smsTemplates: smsTemplatesFor(appId),
    capacityOverrides: {},
    schedule: gideonBooth ? defaultGideonBoothSchedule() : ticketScanning ? defaultTicketScanningSchedule() : null,
    locations: mealSignup ? defaultMealLocations() : [],
    repairs: drivewise ? [] : [],
    paymentBatches: drivewise ? [] : [],
    changeContact: DEFAULT_CHANGE_CONTACT,
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

function emailTemplatesFor(appId = "current") {
  if (appId === "gideonBooth") return GIDEON_EMAIL_TEMPLATES;
  if (appId === "ticketScanning") return TICKET_EMAIL_TEMPLATES;
  if (appId === "mealSignup") return MEAL_EMAIL_TEMPLATES;
  return DEFAULT_EMAIL_TEMPLATES;
}

function smsTemplatesFor(appId = "current") {
  if (appId === "gideonBooth") return GIDEON_SMS_TEMPLATES;
  if (appId === "ticketScanning") return TICKET_SMS_TEMPLATES;
  if (appId === "mealSignup") return MEAL_SMS_TEMPLATES;
  return DEFAULT_SMS_TEMPLATES;
}

function defaultTitleFor(appId = "current") {
  if (appId === "gideonBooth") return "Elkhart County Fair Gideon Booth";
  if (appId === "ticketScanning") return "Elkhart County Fair Ticket Scanning";
  if (appId === "mealSignup") return "Downtown Ministries Meal Signup";
  if (appId === "drivewise") return "Downtown Ministries DriveWise";
  return "Elkhart County Fair Restroom Cleaning";
}

function defaultMealLocations() {
  return [
    {
      id: "goshen",
      name: "Goshen Campus",
      address: "215 W. Clinton St.",
      note: "Monday and Wednesday classes",
      days: [
        {date: "2026-08-03", time: "5:00 PM", day: "Monday", className: "DTM Goshen", expectedMealCount: 28},
        {date: "2026-08-05", time: "5:00 PM", day: "Wednesday", className: "DTM Goshen", expectedMealCount: 28},
        {date: "2026-08-10", time: "5:00 PM", day: "Monday", className: "DTM Goshen", expectedMealCount: 28},
        {date: "2026-08-12", time: "5:00 PM", day: "Wednesday", className: "DTM Goshen", expectedMealCount: 28},
        {date: "2026-08-17", time: "5:00 PM", day: "Monday", className: "DTM Goshen", expectedMealCount: 28},
        {date: "2026-08-19", time: "5:00 PM", day: "Wednesday", className: "DTM Goshen", expectedMealCount: 28},
      ],
    },
    {
      id: "elkhart",
      name: "Elkhart Campus",
      address: "300 W. High St., Elkhart",
      note: "Tuesday and Thursday classes",
      days: [
        {date: "2026-08-04", time: "4:55 PM", day: "Tuesday", className: "DTM Elkhart", expectedMealCount: 34},
        {date: "2026-08-06", time: "5:10 PM", day: "Thursday", className: "DTM Elkhart", expectedMealCount: 34},
        {date: "2026-08-11", time: "4:55 PM", day: "Tuesday", className: "DTM Elkhart", expectedMealCount: 34},
        {date: "2026-08-13", time: "5:10 PM", day: "Thursday", className: "DTM Elkhart", expectedMealCount: 34},
        {date: "2026-08-18", time: "4:55 PM", day: "Tuesday", className: "DTM Elkhart", expectedMealCount: 34},
        {date: "2026-08-20", time: "5:10 PM", day: "Thursday", className: "DTM Elkhart", expectedMealCount: 34},
      ],
    },
    {
      id: "middlebury",
      name: "Middlebury Campus",
      address: "TBD",
      note: "Projected August launch",
      days: [
        {date: "2026-08-06", time: "5:00 PM", day: "Thursday", className: "DTM Middlebury", expectedMealCount: 22},
        {date: "2026-08-13", time: "5:00 PM", day: "Thursday", className: "DTM Middlebury", expectedMealCount: 22},
        {date: "2026-08-20", time: "5:00 PM", day: "Thursday", className: "DTM Middlebury", expectedMealCount: 22},
        {date: "2026-08-27", time: "5:00 PM", day: "Thursday", className: "DTM Middlebury", expectedMealCount: 22},
      ],
    },
  ];
}

function defaultTicketScanningSchedule() {
  const rows = [
    ["2026-07-24", "Ludacris", 20, null, 18],
    ["2026-07-25", "Bret Young", 20, null, 18],
    ["2026-07-26", "Jamie MacDonald", 20, null, 18],
    ["2026-07-27", "Charley Crockett", 20, null, 18],
    ["2026-07-28", "Anne Wilson", 20, null, 18],
    ["2026-07-29", "Tractor Pull 1", 17, null, 16],
    ["2026-07-30", "Tractor Pull 2", 8, 12, 8],
    ["2026-07-30", "Tractor Pull 2", 12, 17, 6],
    ["2026-07-30", "Tractor Pull 3", 17, null, 12],
    ["2026-07-31", "Rodeo 1", 12, 18, 14],
    ["2026-07-31", "Rodeo 2", 18, null, 16],
    ["2026-08-01", "Monster Trucks", 19, null, 16],
  ];

  return {
    title: "Elkhart County Fair Ticket Scanning",
    importedAt: new Date().toISOString(),
    shifts: rows.map(([day, event, startHour, endHour, capacity], index) => ({
      id: `${day}-${index}-ticket-scanning`,
      day,
      startHour,
      endHour,
      capacity,
      teamType: "general",
      label: `${formatHour(startHour)}${endHour === null ? " until finished" : `-${formatHour(endHour)}`} - ${event}`,
      notes: event,
    })),
  };
}

function defaultGideonBoothSchedule() {
  const rows = [
    ["2026-07-24", 11, 14],
    ["2026-07-24", 14, 17],
    ["2026-07-24", 17, 20],
    ["2026-07-24", 20, 22],
    ["2026-07-25", 11, 14],
    ["2026-07-25", 14, 17],
    ["2026-07-25", 17, 20],
    ["2026-07-25", 20, 22],
    ["2026-07-26", 12, 15],
    ["2026-07-26", 15, 18],
    ["2026-07-26", 18, 20],
    ["2026-07-26", 20, 22],
    ["2026-07-27", 11, 14],
    ["2026-07-27", 14, 17],
    ["2026-07-27", 17, 20],
    ["2026-07-27", 20, 22],
    ["2026-07-28", 10, 13],
    ["2026-07-28", 13, 16],
    ["2026-07-28", 16, 19],
    ["2026-07-28", 19, 22],
    ["2026-07-29", 11, 14],
    ["2026-07-29", 14, 17],
    ["2026-07-29", 17, 20],
    ["2026-07-29", 20, 22],
    ["2026-07-30", 11, 14],
    ["2026-07-30", 14, 17],
    ["2026-07-30", 17, 20],
    ["2026-07-30", 20, 22],
    ["2026-07-31", 11, 14],
    ["2026-07-31", 14, 17],
    ["2026-07-31", 17, 20],
    ["2026-07-31", 20, 22],
    ["2026-08-01", 11, 14],
    ["2026-08-01", 14, 17],
    ["2026-08-01", 17, 20],
  ];

  return {
    title: "Elkhart County Fair Gideon Booth",
    importedAt: new Date().toISOString(),
    tagline: "This is a great opportunity for Gideon and Auxiliary partnering together to share God's Word with students.",
    shifts: rows.map(([day, startHour, endHour], index) => ({
      id: `${day}-${index}-gideon-booth`,
      day,
      startHour,
      endHour,
      capacity: 2,
      teamType: "general",
      label: `${formatHour(startHour)}-${formatHour(endHour)} - Gideon Booth`,
      notes: "Gideon Booth",
    })),
  };
}

function normalizeState(input, appId = "current") {
  const source = input && typeof input === "object" ? input : {};
  return {
    ...defaultState(appId),
    ...source,
    volunteers: Array.isArray(source.volunteers) ? source.volunteers.map(normalizeCredentialRecord) : [],
    signups: Array.isArray(source.signups) ? source.signups : [],
    emails: Array.isArray(source.emails) ? source.emails.map((email) => ({
      ...email,
      body: stripPasswordText(email.body || ""),
    })) : [],
    textMessages: Array.isArray(source.textMessages) ? source.textMessages : [],
    emailTemplates: sanitizeEmailTemplates({
      ...emailTemplatesFor(appId),
      ...(source.emailTemplates || {}),
    }),
    smsTemplates: {
      ...smsTemplatesFor(appId),
      ...(source.smsTemplates || {}),
    },
    changeContact: {
      ...DEFAULT_CHANGE_CONTACT,
      ...(source.changeContact || {}),
    },
    capacityOverrides: source.capacityOverrides || {},
    locations: Array.isArray(source.locations) && source.locations.length ? sanitizeMealLocations(source.locations) : defaultState(appId).locations,
    repairs: Array.isArray(source.repairs) ? source.repairs : [],
    paymentBatches: Array.isArray(source.paymentBatches) ? source.paymentBatches : [],
    adminLog: Array.isArray(source.adminLog) ? source.adminLog : [],
    adminCredentials: normalizeCredentialRecord(source.adminCredentials || defaultState(appId).adminCredentials),
    recoveryAdminCredentials: normalizeCredentialRecord(source.recoveryAdminCredentials || defaultState(appId).recoveryAdminCredentials),
    regularAdmins: Array.isArray(source.regularAdmins)
      ? source.regularAdmins.map((record) => ({
        ...normalizeCredentialRecord(record),
        accessLevel: ["full", "schedule", "accounting"].includes(record?.accessLevel) ? record.accessLevel : "schedule",
      }))
      : [],
  };
}

function appIdFromRequest(request) {
  const requested = clean(request.query?.app || request.body?.app || "current");
  return SUPPORTED_APP_IDS.has(requested) ? requested : "current";
}

function stateRefFor(appId) {
  return db.collection("appState").doc(appId);
}

async function readState(appId = "current") {
  const stateRef = stateRefFor(appId);
  const snapshot = await stateRef.get();
  if (!snapshot.exists) {
    const seeded = normalizeState(defaultState(appId), appId);
    await stateRef.set({
      state: seeded,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return seeded;
  }
  return normalizeState(snapshot.data().state, appId);
}

async function writeState(nextState, appId = "current") {
  const stateRef = stateRefFor(appId);
  const normalized = normalizeState(nextState, appId);
  await stateRef.set({
    state: normalized,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  return normalized;
}

async function createMealSignup(request, appId = "mealSignup") {
  const mealAppId = appId === "mealSignup" ? appId : "mealSignup";
  const body = request.body || {};
  const dates = Array.isArray(body.dates) ? body.dates.map(clean).filter(Boolean) : [];
  const locationId = clean(body.locationId);
  if (!locationId || !dates.length) {
    return {ok: false, error: "Choose a location and at least one meal date."};
  }

  const stateRef = stateRefFor(mealAppId);
  let savedState = null;
  let savedSignup = null;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    const currentState = snapshot.exists
      ? normalizeState(snapshot.data().state, mealAppId)
      : normalizeState(defaultState(mealAppId), mealAppId);
    const location = currentState.locations.find((item) => item.id === locationId);
    if (!location) throw new Error("That location could not be found.");

    const availableDates = new Map(
      location.days
        .filter((day) => isMealDateUpcoming(day.date))
        .map((day) => [day.date, day]),
    );
    const unavailable = dates.filter((date) => {
      const alreadyClaimed = currentState.signups.some((signup) => (
        signup.locationId === locationId && (signup.dates || []).includes(date)
      ));
      return alreadyClaimed || !availableDates.has(date);
    });
    if (unavailable.length) {
      throw new Error("One or more selected dates are no longer available.");
    }

    const signup = buildMealSignup(body, location, dates, availableDates);
    currentState.signups.push(signup);
    currentState.emails.push(...buildMealEmails(signup, currentState.emailTemplates));
    currentState.textMessages.push(...buildMealTextMessages(signup, currentState.smsTemplates));
    transaction.set(stateRef, {
      state: currentState,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    savedState = currentState;
    savedSignup = signup;
  });

  return {ok: true, state: savedState, signup: savedSignup};
}

function buildMealSignup(body, location, dates, availableDates) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    locationId: location.id,
    locationName: location.name,
    address: location.address,
    dates,
    dateDetails: dates.map((date) => ({
      date,
      time: availableDates.get(date).time,
      day: availableDates.get(date).day,
      className: availableDates.get(date).className,
      expectedMealCount: availableDates.get(date).expectedMealCount,
    })),
    fullName: clean(body.fullName),
    phone: clean(body.phone),
    email: normalizeEmail(body.email),
    addressLine: clean(body.address),
    churchGroup: clean(body.churchGroup),
    meal: clean(body.meal),
    notes: clean(body.notes),
    textReminders: body.textReminders !== false,
  };
}

function buildMealEmails(signup, templates) {
  const messages = [];
  for (const dateDetail of signup.dateDetails) {
    const values = mealTemplateValues(signup, dateDetail);
    messages.push({
      id: `${signup.id}-${dateDetail.date}-email-confirmation`,
      signupId: signup.id,
      to: signup.email,
      subject: fillTemplate(templates.confirmation.subject, values),
      body: fillTemplate(templates.confirmation.body, values),
      sendOn: new Date().toISOString(),
      type: "confirmation",
      status: "queued",
    });
    messages.push({
      id: `${signup.id}-${dateDetail.date}-email-one-week`,
      signupId: signup.id,
      to: signup.email,
      subject: fillTemplate(templates["one-week-reminder"].subject, values),
      body: fillTemplate(templates["one-week-reminder"].body, values),
      sendOn: reminderIso(dateDetail.date, -7),
      type: "one-week-reminder",
      status: "queued",
    });
    messages.push({
      id: `${signup.id}-${dateDetail.date}-email-day-before`,
      signupId: signup.id,
      to: signup.email,
      subject: fillTemplate(templates["day-before-reminder"].subject, values),
      body: fillTemplate(templates["day-before-reminder"].body, values),
      sendOn: reminderIso(dateDetail.date, -1),
      type: "day-before-reminder",
      status: "queued",
    });
  }
  return messages;
}

function buildMealTextMessages(signup, templates) {
  if (!signup.textReminders || !normalizePhone(signup.phone)) return [];
  const messages = [];
  for (const dateDetail of signup.dateDetails) {
    const values = mealTemplateValues(signup, dateDetail);
    messages.push({
      id: `${signup.id}-${dateDetail.date}-sms-confirmation`,
      signupId: signup.id,
      to: signup.phone,
      body: fillTemplate(templates.confirmation, values),
      sendOn: new Date().toISOString(),
      type: "confirmation",
      status: "queued",
    });
    messages.push({
      id: `${signup.id}-${dateDetail.date}-sms-one-week`,
      signupId: signup.id,
      to: signup.phone,
      body: fillTemplate(templates["one-week-reminder"], values),
      sendOn: reminderIso(dateDetail.date, -7),
      type: "one-week-reminder",
      status: "queued",
    });
    messages.push({
      id: `${signup.id}-${dateDetail.date}-sms-day-before`,
      signupId: signup.id,
      to: signup.phone,
      body: fillTemplate(templates["day-before-reminder"], values),
      sendOn: reminderIso(dateDetail.date, -1),
      type: "day-before-reminder",
      status: "queued",
    });
  }
  return messages;
}

function mealTemplateValues(signup, dateDetail) {
  return {
    name: signup.fullName,
    location: signup.locationName,
    date: formatMealDate(dateDetail.date),
    time: dateDetail.time,
    servingSize: String(dateDetail.expectedMealCount || signup.servingSize || ""),
    meal: signup.meal || "meal details to be confirmed",
  };
}

function fillTemplate(template, values) {
  return clean(template).replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  ));
}

function reminderIso(date, daysBefore) {
  const reminder = new Date(`${date}T09:00:00-04:00`);
  reminder.setDate(reminder.getDate() + daysBefore);
  return reminder.toISOString();
}

function formatMealDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function todayDateKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function isMealDateUpcoming(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(date)) && clean(date) >= todayDateKey();
}

function formatDateOnly(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function createReimbursementRequest(request) {
  const body = request.body || {};
  const receipts = Array.isArray(body.receipts) ? body.receipts : [];
  const fullName = clean(body.fullName);
  const className = clean(body.className);
  const classDate = clean(body.classDate);

  if (!fullName || !className || !classDate) {
    return {ok: false, error: "Name, class, and date are required."};
  }
  if (!receipts.length) {
    return {ok: false, error: "Upload at least one receipt."};
  }
  if (receipts.length > 12) {
    return {ok: false, error: "Upload 12 receipts or fewer per request."};
  }

  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let normalizedReceipts;
  try {
    normalizedReceipts = receipts.map((receipt, index) => normalizeReceipt(receipt, index));
  } catch (error) {
    return {ok: false, error: error.message};
  }
  const totalAmount = normalizedReceipts.reduce((total, receipt) => total + receipt.amount, 0);
  const createdAt = new Date().toISOString();
  const folder = `reimbursements/pending/${requestId}`;
  const bucket = storage.bucket(storageBucketName);
  const pdfBuffer = await buildReimbursementPdf({
    requestId,
    createdAt,
    fullName,
    className,
    classDate,
    notes: clean(body.notes),
    receipts: normalizedReceipts,
    totalAmount,
  });
  let fileMode = "storage";
  let uploadedReceipts;
  let pdfPath = `${folder}/reimbursement-request.pdf`;

  try {
    uploadedReceipts = await saveReimbursementFilesToStorage(bucket, folder, normalizedReceipts, pdfBuffer);
  } catch (error) {
    if (!isMissingBucketError(error)) throw error;
    logger.warn("Firebase Storage bucket is not set up. Saving reimbursement files to Firestore fallback.", {
      bucket: storageBucketName,
      requestId,
    });
    fileMode = "firestore";
    pdfPath = `reimbursementRequests/${requestId}/files/pdf`;
    uploadedReceipts = await saveReimbursementFilesToFirestore(requestId, normalizedReceipts, pdfBuffer);
  }

  await db.collection("reimbursementRequests").doc(requestId).set({
    requestId,
    createdAt,
    status: "pending",
    fullName,
    className,
    classDate,
    notes: clean(body.notes),
    totalAmount,
    receiptCount: uploadedReceipts.length,
    receipts: uploadedReceipts,
    pdfPath,
    fileMode,
  });

  return {
    ok: true,
    requestId,
    totalAmount,
    receiptCount: uploadedReceipts.length,
    pdfPath,
    fileMode,
  };
}

async function saveReimbursementFilesToStorage(bucket, folder, receipts, pdfBuffer) {
  const uploadedReceipts = [];
  for (const receipt of receipts) {
    const extension = receipt.contentType === "image/png" ? "png" : "jpg";
    const storagePath = `${folder}/receipt-${String(receipt.index + 1).padStart(2, "0")}.${extension}`;
    await bucket.file(storagePath).save(receipt.buffer, {
      contentType: receipt.contentType,
      metadata: {
        cacheControl: "private, max-age=0, no-transform",
      },
    });
    uploadedReceipts.push({
      amount: receipt.amount,
      originalName: receipt.originalName,
      contentType: receipt.contentType,
      storagePath,
    });
  }

  const pdfPath = `${folder}/reimbursement-request.pdf`;
  await bucket.file(pdfPath).save(pdfBuffer, {
    contentType: "application/pdf",
    metadata: {
      cacheControl: "private, max-age=0, no-transform",
    },
  });

  return uploadedReceipts;
}

async function saveReimbursementFilesToFirestore(requestId, receipts, pdfBuffer) {
  const requestRef = db.collection("reimbursementRequests").doc(requestId);
  const uploadedReceipts = [];
  for (const receipt of receipts) {
    const fileId = `receipt-${String(receipt.index + 1).padStart(2, "0")}`;
    await saveChunkedFile(requestRef, fileId, receipt.buffer, {
      amount: receipt.amount,
      originalName: receipt.originalName,
      contentType: receipt.contentType,
      kind: "receipt",
    });
    uploadedReceipts.push({
      amount: receipt.amount,
      originalName: receipt.originalName,
      contentType: receipt.contentType,
      firestorePath: `${requestRef.path}/files/${fileId}`,
    });
  }

  await saveChunkedFile(requestRef, "pdf", pdfBuffer, {
    originalName: "reimbursement-request.pdf",
    contentType: "application/pdf",
    kind: "pdf",
  });
  return uploadedReceipts;
}

async function saveChunkedFile(requestRef, fileId, buffer, metadata) {
  const fileRef = requestRef.collection("files").doc(fileId);
  const base64 = buffer.toString("base64");
  const chunkSize = 650000;
  const chunks = base64.match(new RegExp(`.{1,${chunkSize}}`, "g")) || [];

  await fileRef.set({
    ...metadata,
    byteLength: buffer.length,
    encoding: "base64",
    chunkCount: chunks.length,
    createdAt: new Date().toISOString(),
  });

  const batchLimit = 450;
  for (let offset = 0; offset < chunks.length; offset += batchLimit) {
    const batch = db.batch();
    chunks.slice(offset, offset + batchLimit).forEach((chunk, index) => {
      const chunkIndex = offset + index;
      batch.set(fileRef.collection("chunks").doc(String(chunkIndex).padStart(5, "0")), {
        index: chunkIndex,
        data: chunk,
      });
    });
    await batch.commit();
  }
}

function isMissingBucketError(error) {
  const message = clean(error?.message);
  return error?.status === 404 || message.includes("bucket does not exist");
}

async function adminLogin(request, appId = "mealSignup") {
  const adminAppId = ["mealSignup", "drivewise"].includes(appId) ? appId : "mealSignup";
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  if (!username || !password) return {ok: false, error: "Enter an admin login and password."};

  const state = await readState(adminAppId);
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
    const regularAdmin = (state.regularAdmins || []).find((admin) => (
      normalizeAdminLogin(admin.username) === normalizedUsername
      && credentialMatches(admin, passwordHash, password)
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
    appId: adminAppId,
    role,
    adminId,
    username: displayName,
    forcePasswordChange,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
  });

  logStateChange(state, displayName, "Admin login", `${displayName} logged in as ${role}.`);
  await writeState(state, adminAppId);

  return {ok: true, token: rawToken, role, username: displayName};
}

async function requireAdmin(request, requestedAppId, allowedRoles) {
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
  const appId = SUPPORTED_APP_IDS.has(session.appId) ? session.appId : requestedAppId;
  if (!["mealSignup", "drivewise"].includes(appId)) {
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
  if (session.forcePasswordChange && !allowedRoles.includes("password-change")) {
    const error = new Error("Change your temporary password before continuing.");
    error.statusCode = 403;
    throw error;
  }
  return {...session, appId, tokenHash};
}

async function adminState(appId, session) {
  const state = await readState(appId);
  const canViewReimbursements = ["full", "accounting"].includes(session.role);
  return {
    ok: true,
    role: session.role,
    username: session.username,
    forcePasswordChange: Boolean(session.forcePasswordChange),
    locations: state.locations || [],
    signups: state.signups || [],
    adminLog: state.adminLog || [],
    mainAdminUsername: state.adminCredentials?.username || "admin",
    regularAdmins: (state.regularAdmins || []).map((admin) => ({
      id: admin.id,
      username: admin.username,
      accessLevel: admin.accessLevel || "schedule",
      createdAt: admin.createdAt || "",
    })),
    reimbursements: canViewReimbursements ? await listReimbursementRequests() : [],
  };
}

async function changeOwnAdminPassword(request, session) {
  const password = clean(request.body?.password);
  if (password.length < 6) return {ok: false, error: "New password must be at least 6 characters."};
  if (!session.adminId || ["main", "recovery"].includes(session.adminId)) {
    return {ok: false, error: "This account does not need a temporary password change."};
  }
  const state = await readState(session.appId);
  const target = (state.regularAdmins || []).find((admin) => admin.id === session.adminId);
  if (!target) return {ok: false, error: "Admin account was not found."};
  target.passwordHash = hashPassword(password);
  target.forcePasswordChange = false;
  logStateChange(state, session.username, "Change admin password", `${session.username} changed a temporary admin password.`);
  await writeState(state, session.appId);
  await adminSessionCollection.doc(session.tokenHash).update({forcePasswordChange: false});
  return adminState(session.appId, {...session, forcePasswordChange: false});
}

async function listReimbursementRequests() {
  const snapshot = await db.collection("reimbursementRequests")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return Promise.all(snapshot.docs.map(async (doc) => {
    const data = doc.data() || {};
    const pdfUrl = data.pdfPath && data.fileMode === "storage" ? await signedStorageUrl(data.pdfPath) : "";
    const receipts = await Promise.all((Array.isArray(data.receipts) ? data.receipts : []).map(async (receipt, index) => ({
      label: receipt.originalName || `Receipt ${index + 1}`,
      path: receipt.storagePath || receipt.firestorePath || "",
      url: receipt.storagePath ? await signedStorageUrl(receipt.storagePath) : "",
    })));
    return {
      id: doc.id,
      createdAt: data.createdAt || "",
      fullName: data.fullName || "",
      className: data.className || "",
      classDate: data.classDate || "",
      totalAmount: data.totalAmount || 0,
      status: data.status || "pending",
      files: [
        data.pdfPath ? {label: "PDF", path: data.pdfPath, url: pdfUrl} : null,
        ...receipts,
      ].filter(Boolean),
    };
  }));
}

async function signedStorageUrl(path) {
  if (!path) return "";
  try {
    const [url] = await storage.bucket(storageBucketName).file(path).getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });
    return url;
  } catch (error) {
    logger.warn("Could not create reimbursement download URL", {path, error: error.message});
    return "";
  }
}

async function updateMealLocations(request, session) {
  const state = await readState(session.appId);
  const locations = Array.isArray(request.body?.locations) ? request.body.locations : [];
  if (!locations.length) return {ok: false, error: "At least one location is required."};
  state.locations = sanitizeMealLocations(locations);
  logStateChange(state, session.username, "Update meal schedule", `${session.username} updated meal locations and dates.`);
  await writeState(state, session.appId);
  return {ok: true, locations: state.locations, adminLog: state.adminLog};
}

function sanitizeMealLocations(locations) {
  return locations.map((location, index) => {
    const id = clean(location.id) || slugify(location.name) || `location-${index + 1}`;
    const days = Array.isArray(location.days) ? location.days : [];
    return {
      id,
      name: clean(location.name) || `Location ${index + 1}`,
      address: clean(location.address),
      note: clean(location.note),
      days: days
        .map((day) => ({
          date: clean(day.date),
          time: clean(day.time) || "5:00 PM",
          day: weekdayForDate(day.date),
          className: clean(day.className),
          expectedMealCount: Math.max(
            1,
            Number.parseInt(day.expectedMealCount || day.servingSize || location.servingSize, 10) || 1,
          ),
        }))
        .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
}

async function updateMainAdminAccount(request, session) {
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  if (!username) return {ok: false, error: "Enter a main full-admin login name."};
  if (password && password.length < 6) return {ok: false, error: "New password must be at least 6 characters."};

  const state = await readState(session.appId);
  state.adminCredentials = {
    ...state.adminCredentials,
    username,
    ...(password ? {passwordHash: hashPassword(password)} : {}),
  };
  const actor = session.role === "recovery" ? "ALF" : session.username;
  logStateChange(state, actor, "Reset main admin account", `${actor} reset the main full-admin account.`);
  await writeState(state, session.appId);
  return {ok: true, mainAdminUsername: username, adminLog: state.adminLog};
}

async function addRegularAdmin(request, session) {
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  const accessLevel = ["full", "schedule", "accounting"].includes(clean(request.body?.accessLevel))
    ? clean(request.body?.accessLevel)
    : "schedule";
  if (!username || password.length < 6) return {ok: false, error: "Enter an admin login and temporary password of at least 6 characters."};
  const state = await readState(session.appId);
  if ((state.regularAdmins || []).some((admin) => normalizeAdminLogin(admin.username) === normalizeAdminLogin(username))) {
    return {ok: false, error: "That admin already exists."};
  }
  state.regularAdmins = [
    ...(state.regularAdmins || []),
    {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username,
      passwordHash: hashPassword(password),
      accessLevel,
      forcePasswordChange: accessLevel === "full",
      createdAt: new Date().toISOString(),
    },
  ];
  logStateChange(state, session.username, "Add admin account", `${session.username} added ${accessLevel} admin ${username}.`);
  await writeState(state, session.appId);
  return adminState(session.appId, session);
}

async function deleteRegularAdmin(request, session) {
  const adminId = clean(request.body?.id);
  const state = await readState(session.appId);
  const target = (state.regularAdmins || []).find((admin) => admin.id === adminId);
  if (!target) return {ok: false, error: "That regular admin was not found."};
  state.regularAdmins = state.regularAdmins.filter((admin) => admin.id !== adminId);
  logStateChange(state, session.username, "Delete regular admin", `${session.username} deleted regular admin ${target.username}.`);
  await writeState(state, session.appId);
  return adminState(session.appId, session);
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

function weekdayForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(date))) return "";
  return new Intl.DateTimeFormat("en-US", {weekday: "long"}).format(new Date(`${date}T12:00:00`));
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function drivewiseState(session) {
  const state = await readState("drivewise");
  return {
    ok: true,
    role: session.role,
    username: session.username,
    title: state.title || defaultTitleFor("drivewise"),
    repairs: state.repairs || [],
    paymentBatches: state.paymentBatches || [],
    adminLog: state.adminLog || [],
  };
}

async function saveDrivewiseRepair(request, session) {
  const state = await readState("drivewise");
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

  logStateChange(state, session.username, existingIndex >= 0 ? "Update DriveWise repair" : "Add DriveWise repair", `${session.username} saved repair record for ${repair.ownerName}.`);
  await writeState(state, "drivewise");
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

async function deleteDrivewiseRepair(request, session) {
  const repairId = clean(request.body?.id);
  const state = await readState("drivewise");
  const repair = (state.repairs || []).find((item) => item.id === repairId);
  if (!repair) return {ok: false, error: "Repair record was not found."};
  state.repairs = state.repairs.filter((item) => item.id !== repairId);
  logStateChange(state, session.username, "Delete DriveWise repair", `${session.username} deleted repair record for ${repair.ownerName}.`);
  await writeState(state, "drivewise");
  return drivewiseState(session);
}

async function updateDrivewiseInvoiceStatus(request, session) {
  const {repairId, invoiceId} = request.body || {};
  const updates = request.body?.updates || {};
  const state = await readState("drivewise");
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
  await writeState(state, "drivewise");
  return drivewiseState(session);
}

async function createDrivewisePaymentBatch(request, session) {
  const vendor = clean(request.body?.vendor);
  if (!vendor) return {ok: false, error: "Choose a vendor to create a payment batch."};
  const state = await readState("drivewise");
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
  await writeState(state, "drivewise");
  return drivewiseState(session);
}

function normalizeReceipt(receipt, index) {
  const amount = Number.parseFloat(receipt?.amount);
  const contentType = clean(receipt?.contentType);
  const data = clean(receipt?.data);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Receipt ${index + 1} needs a valid reimbursement amount.`);
  }
  if (!["image/jpeg", "image/png"].includes(contentType)) {
    throw new Error(`Receipt ${index + 1} must be a JPG or PNG image.`);
  }
  if (!data) {
    throw new Error(`Receipt ${index + 1} is missing an uploaded image.`);
  }
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error(`Receipt ${index + 1} must be smaller than 8 MB.`);
  }
  return {
    index,
    amount,
    contentType,
    originalName: clean(receipt?.name) || `Receipt ${index + 1}`,
    buffer,
  };
}

function buildReimbursementPdf(requestData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({autoFirstPage: false, margin: 48});
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();
    doc.fontSize(20).text("Downtown Ministries Reimbursement Request", {align: "center"});
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`Request ID: ${requestData.requestId}`);
    doc.text(`Submitted: ${formatDateTime(requestData.createdAt)}`);
    doc.text(`Name: ${requestData.fullName}`);
    doc.text(`Class: ${requestData.className}`);
    doc.text(`Date: ${formatDateOnly(`${requestData.classDate}T12:00:00`)}`);
    if (requestData.notes) doc.text(`Notes: ${requestData.notes}`);
    doc.moveDown();
    doc.fontSize(14).text("Receipts", {underline: true});
    doc.moveDown(0.5);
    requestData.receipts.forEach((receipt) => {
      doc.fontSize(11).text(`Receipt ${receipt.index + 1}: ${formatCurrency(receipt.amount)}`);
    });
    doc.moveDown();
    doc.fontSize(14).text(`Total reimbursement requested: ${formatCurrency(requestData.totalAmount)}`);

    requestData.receipts.forEach((receipt) => {
      doc.addPage();
      doc.fontSize(16).text(`Receipt ${receipt.index + 1} - ${formatCurrency(receipt.amount)}`);
      doc.fontSize(10).fillColor("#555").text(receipt.originalName);
      doc.fillColor("#000").moveDown();
      try {
        doc.image(receipt.buffer, {
          fit: [500, 650],
          align: "center",
          valign: "top",
        });
      } catch (error) {
        doc.fontSize(11).text(`The uploaded receipt image could not be embedded: ${error.message}`);
      }
    });

    doc.end();
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function sendJson(response, status, body) {
  response.status(status).set("Cache-Control", "no-store").json(body);
}

function routePath(request) {
  const path = request.path || "";
  return path.replace(/^\/api/, "") || "/";
}

exports.api = onRequest({cors: true, invoker: "public", secrets: providerSecrets}, async (request, response) => {
  try {
    const path = routePath(request);
    const appId = appIdFromRequest(request);

    if (request.method === "GET" && (path === "/state" || path === "/")) {
      sendJson(response, 200, {state: await readState(appId), app: appId});
      return;
    }

    if (request.method === "POST" && path === "/state") {
      const body = request.body || {};
      if (!body.state || typeof body.state !== "object") {
        sendJson(response, 400, {error: "Missing state payload."});
        return;
      }
      sendJson(response, 200, {state: await writeState(body.state, appId), app: appId});
      return;
    }

    if (request.method === "POST" && path === "/meal-signup") {
      const result = await createMealSignup(request, appId);
      sendJson(response, result.ok ? 200 : 409, result);
      return;
    }

    if (request.method === "POST" && path === "/reimbursement") {
      const result = await createReimbursementRequest(request);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-login") {
      const result = await adminLogin(request, appId);
      sendJson(response, result.ok ? 200 : 401, result);
      return;
    }

    if (request.method === "GET" && path === "/admin-state") {
      const session = await requireAdmin(request, appId, ["full", "schedule", "accounting", "recovery", "password-change"]);
      sendJson(response, 200, await adminState(session.appId, session));
      return;
    }

    if (request.method === "POST" && path === "/admin-change-own-password") {
      const session = await requireAdmin(request, appId, ["full", "schedule", "accounting", "password-change"]);
      const result = await changeOwnAdminPassword(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-locations") {
      const session = await requireAdmin(request, appId, ["full", "schedule"]);
      const result = await updateMealLocations(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-main-account") {
      const session = await requireAdmin(request, appId, ["full", "recovery"]);
      const result = await updateMainAdminAccount(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-regular-admins") {
      const session = await requireAdmin(request, appId, ["full"]);
      const result = await addRegularAdmin(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/admin-delete-regular-admin") {
      const session = await requireAdmin(request, appId, ["full"]);
      const result = await deleteRegularAdmin(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "GET" && path === "/drivewise-state") {
      const session = await requireAdmin(request, "drivewise", ["full", "schedule", "accounting"]);
      sendJson(response, 200, await drivewiseState(session));
      return;
    }

    if (request.method === "POST" && path === "/drivewise-repair") {
      const session = await requireAdmin(request, "drivewise", ["full", "schedule"]);
      const result = await saveDrivewiseRepair(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-delete-repair") {
      const session = await requireAdmin(request, "drivewise", ["full", "schedule"]);
      const result = await deleteDrivewiseRepair(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-invoice-status") {
      const session = await requireAdmin(request, "drivewise", ["full", "accounting"]);
      const result = await updateDrivewiseInvoiceStatus(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/drivewise-payment-batch") {
      const session = await requireAdmin(request, "drivewise", ["full", "accounting"]);
      const result = await createDrivewisePaymentBatch(request, session);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/send-due-messages") {
      const result = await sendDueMessages(appId);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && path === "/request-password-reset") {
      const result = await requestPasswordReset(request, appId);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && path === "/request-change-link") {
      const result = await requestChangeLink(request, appId);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && path === "/authenticate-change-link") {
      const result = await authenticateChangeLink(request, appId);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/reset-password") {
      const result = await resetVolunteerPassword(request, appId);
      sendJson(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && path === "/reset-live-data") {
      const result = await resetLiveData(request, appId);
      sendJson(response, result.ok ? 200 : 403, result);
      return;
    }

    sendJson(response, 404, {error: "Unknown API route."});
  } catch (error) {
    logger.error("API request failed", error);
    sendJson(response, error.statusCode || 500, {error: error.statusCode ? error.message : "Server error."});
  }
});

async function requestPasswordReset(request, appId = "current") {
  const login = clean(request.body?.login);
  if (!login) return {ok: true};

  const state = await readState(appId);
  const volunteer = (state.volunteers || []).find((item) => contactMatchesLogin(item, login));
  if (!volunteer || !volunteer.email) {
    return {ok: true};
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const appBaseUrl = clean(process.env.APP_BASE_URL || request.get("origin") || `${request.get("x-forwarded-proto") || "https"}://${request.get("host")}`)
    .replace(/\/api\/?.*$/, "")
    .replace(/\/$/, "");
  const resetUrl = `${appBaseUrl}/index.html#resetToken=${encodeURIComponent(rawToken)}`;

  await passwordResetCollection.add({
    tokenHash,
    appId,
    email: normalizeEmail(volunteer.email),
    mobilePhone: normalizePhone(volunteer.mobilePhone),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    usedAt: null,
  });

  await sendPostmarkEmail({
    to: volunteer.email,
    subject: "Reset your volunteer signup password",
    body: [
      `${volunteer.firstName || "Volunteer"}, use this link to reset your volunteer signup password:`,
      "",
      resetUrl,
      "",
      "This link expires in 1 hour. If you did not request this reset, you can ignore this email.",
    ].join("\n"),
  });

  return {ok: true};
}

async function requestChangeLink(request, appId = "current") {
  const email = normalizeEmail(request.body?.email || request.body?.login);
  if (!email) return {ok: true};

  const state = await readState(appId);
  const matches = (state.volunteers || []).filter((volunteer) => normalizeEmail(volunteer.email) === email);
  if (!matches.length) return {ok: true};

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const appBaseUrl = clean(process.env.APP_BASE_URL || request.get("origin") || `${request.get("x-forwarded-proto") || "https"}://${request.get("host")}`)
    .replace(/\/api\/?.*$/, "")
    .replace(/\/$/, "");
  const changeUrl = `${appBaseUrl}/index.html#changeToken=${encodeURIComponent(rawToken)}`;
  const first = matches[0];

  await changeLinkCollection.add({
    tokenHash,
    appId,
    email,
    volunteerIds: matches.map((volunteer) => volunteer.id).filter(Boolean),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    lastUsedAt: null,
  });

  try {
    await sendPostmarkEmail({
      to: first.email,
      subject: "Access your Gideon Booth volunteer shifts",
      body: [
        `${first.firstName || "Volunteer"}, use this secure link to view or change your Gideon Booth volunteer time slots:`,
        "",
        changeUrl,
        "",
        "This link expires in 1 hour. Online changes are only allowed until two weeks before your first scheduled time slot.",
        "If you did not request this link, you can ignore this email.",
      ].join("\n"),
    });
  } catch (error) {
    logger.error("Change link email failed", error);
    const message = clean(error.message).includes("pending approval")
      ? "Postmark is still pending approval and can only send to email addresses on the same domain as the From address."
      : "The email provider could not send the change link right now.";
    return {ok: false, error: message};
  }

  return {ok: true};
}

async function authenticateChangeLink(request, appId = "current") {
  const token = clean(request.body?.token);
  if (!token) return {ok: false, error: "This change link is invalid or expired."};

  const tokenHash = hashToken(token);
  const linkSnapshot = await changeLinkCollection.where("tokenHash", "==", tokenHash).limit(1).get();
  if (linkSnapshot.empty) return {ok: false, error: "This change link is invalid or expired."};

  const linkDoc = linkSnapshot.docs[0];
  const link = linkDoc.data();
  const linkAppId = SUPPORTED_APP_IDS.has(link.appId) ? link.appId : appId;
  if (!link.expiresAt || link.expiresAt.toMillis() < Date.now()) {
    return {ok: false, error: "This change link is invalid or expired."};
  }

  const state = await readState(linkAppId);
  const ids = new Set(Array.isArray(link.volunteerIds) ? link.volunteerIds : []);
  const volunteerIds = (state.volunteers || [])
    .filter((volunteer) => ids.has(volunteer.id) || normalizeEmail(volunteer.email) === link.email)
    .map((volunteer) => volunteer.id)
    .filter(Boolean);

  if (!volunteerIds.length) return {ok: false, error: "No volunteer signup was found for this change link."};

  await linkDoc.ref.update({
    lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {ok: true, email: link.email, volunteerIds};
}

async function resetVolunteerPassword(request, appId = "current") {
  const token = clean(request.body?.token);
  const newPassword = clean(request.body?.password);
  if (!token || newPassword.length < 6) {
    return {ok: false, error: "Enter a new password with at least 6 characters."};
  }

  const tokenHash = hashToken(token);
  const resetSnapshot = await passwordResetCollection.where("tokenHash", "==", tokenHash).limit(1).get();
  if (resetSnapshot.empty) return {ok: false, error: "This reset link is invalid or expired."};

  const resetDoc = resetSnapshot.docs[0];
  const reset = resetDoc.data();
  const resetAppId = SUPPORTED_APP_IDS.has(reset.appId) ? reset.appId : appId;
  if (reset.usedAt || !reset.expiresAt || reset.expiresAt.toMillis() < Date.now()) {
    return {ok: false, error: "This reset link is invalid or expired."};
  }

  const state = await readState(resetAppId);
  let updatedCount = 0;
  const affectedIds = new Set();
  let resetLogin = reset.email || reset.mobilePhone || "";
  (state.volunteers || []).forEach((volunteer) => {
    const sameEmail = reset.email && normalizeEmail(volunteer.email) === reset.email;
    const samePhone = reset.mobilePhone && normalizePhone(volunteer.mobilePhone) === reset.mobilePhone;
    if (sameEmail || samePhone) {
      volunteer.passwordHash = hashPassword(newPassword);
      delete volunteer.password;
      affectedIds.add(volunteer.id);
      if (!resetLogin) resetLogin = volunteer.email || volunteer.mobilePhone || "";
      updatedCount += 1;
    }
  });

  if (!updatedCount) return {ok: false, error: "No volunteer signup was found for this reset link."};

  (state.emails || []).forEach((email) => {
    if (affectedIds.has(email.volunteerId) && email.body) {
      email.body = stripPasswordText(email.body);
    }
  });

  await writeState(state, resetAppId);
  await resetDoc.ref.update({
    usedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return {ok: true, login: resetLogin, updatedCount};
}

async function resetLiveData(request, appId = "current") {
  const state = await readState(appId);
  const username = clean(request.body?.username);
  const password = clean(request.body?.password);
  if (
    normalizeEmail(username) !== normalizeEmail(state.adminCredentials?.username)
    || !credentialMatches(state.adminCredentials, hashPassword(password), password)
  ) {
    return {ok: false, error: "Full admin login is incorrect."};
  }

  state.volunteers = [];
  state.emails = [];
  state.textMessages = [];
  if (appId === "mealSignup") state.signups = [];
  state.adminLog = [];
  state.capacityOverrides = {};
  state.emailTemplates = sanitizeEmailTemplates(emailTemplatesFor(appId));
  state.smsTemplates = smsTemplatesFor(appId);
  if (state.schedule?.title) state.schedule.title = defaultTitleFor(appId);
  await writeState(state, appId);
  return {ok: true};
}

exports.sendQueuedMessages = onSchedule({schedule: "every 5 minutes", secrets: providerSecrets}, async () => {
  const result = await sendDueMessagesForAllApps();
  logger.info("Queued message sender finished", result);
});

async function sendDueMessagesForAllApps() {
  const results = [];
  for (const appId of SUPPORTED_APP_IDS) {
    results.push(await sendDueMessages(appId));
  }
  return {
    apps: results,
    emailsSent: results.reduce((total, result) => total + result.emailsSent, 0),
    textsSent: results.reduce((total, result) => total + result.textsSent, 0),
    failed: results.reduce((total, result) => total + result.failed, 0),
  };
}

async function sendDueMessages(appId = "current") {
  const state = await readState(appId);
  const now = Date.now();
  let emailsSent = 0;
  let textsSent = 0;
  let failed = 0;

  for (const message of state.emails || []) {
    if (message.sentAt || Date.parse(message.sendOn) > now) continue;
    try {
      const providerId = await sendPostmarkEmail(message);
      message.sentAt = new Date().toISOString();
      message.status = "sent";
      message.providerId = providerId;
      emailsSent += 1;
    } catch (error) {
      message.status = "failed";
      message.errorMessage = error.message;
      failed += 1;
    }
  }

  for (const message of state.textMessages || []) {
    if (message.sentAt || Date.parse(message.sendOn) > now) continue;
    try {
      const providerId = await sendTwilioText(message);
      message.sentAt = new Date().toISOString();
      message.status = "sent";
      message.providerId = providerId;
      textsSent += 1;
    } catch (error) {
      message.status = "failed";
      message.errorMessage = error.message;
      failed += 1;
    }
  }

  await writeState(state, appId);
  return {app: appId, emailsSent, textsSent, failed};
}

async function sendPostmarkEmail(message) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const fromEmail = process.env.POSTMARK_FROM_EMAIL;
  if (!token || !fromEmail) throw new Error("Postmark environment variables are not configured.");

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: fromEmail,
      To: message.to,
      Subject: message.subject,
      TextBody: message.body,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.Message || `Postmark failed with ${response.status}.`);
  return payload.MessageID || "";
}

async function sendTwilioText(message) {
  const accountSid = clean(process.env.TWILIO_ACCOUNT_SID);
  const authToken = clean(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = clean(process.env.TWILIO_FROM_NUMBER);
  if (!accountSid || !authToken || !fromNumber) throw new Error("Twilio environment variables are not configured.");
  if (accountSid === "placeholder" || authToken === "placeholder" || fromNumber === "+10000000000") {
    throw new Error("Twilio secrets are still set to placeholder values.");
  }

  const form = new URLSearchParams();
  form.set("To", toTwilioPhoneNumber(message.to));
  form.set("From", toTwilioPhoneNumber(fromNumber));
  form.set("Body", message.body);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Twilio failed with ${response.status}.`);
  return payload.sid || "";
}

function toTwilioPhoneNumber(value) {
  const phone = clean(value);
  if (phone.startsWith("+")) return phone;
  const digits = normalizePhone(phone);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone;
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

function normalizePhone(value) {
  return clean(value).replace(/\D/g, "");
}

function formatHour(hour) {
  const wholeHour = Math.floor(hour);
  const minutes = Math.round((hour - wholeHour) * 60);
  const suffix = wholeHour >= 12 ? "PM" : "AM";
  const normalized = wholeHour % 12 || 12;
  return minutes ? `${normalized}:${String(minutes).padStart(2, "0")} ${suffix}` : `${normalized} ${suffix}`;
}

function contactMatchesLogin(volunteer, login) {
  const emailLogin = normalizeEmail(login);
  const phoneLogin = normalizePhone(login);
  return normalizeEmail(volunteer.email) === emailLogin || normalizePhone(volunteer.mobilePhone) === phoneLogin;
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

function stripPasswordText(text) {
  return clean(text)
    .replace(/\s*Your password is \{password\}\.?/g, "")
    .replace(/\s*Your password is [^.]+\.?/g, "");
}

function sanitizeEmailTemplates(templates) {
  return Object.fromEntries(Object.entries(templates || {}).map(([key, template]) => [
    key,
    {
      ...template,
      body: stripPasswordText(template?.body || ""),
    },
  ]));
}
