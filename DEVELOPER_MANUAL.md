# DTM DriveWise - Developer Manual

Last updated: June 28, 2026

## Purpose and URLs

DriveWise is Downtown Ministries' internal vehicle repair, shop supply, vendor
invoice, statement, and payment tracking application.

- Production app: https://drivewise.web.app/
- GitHub repository: https://github.com/timorningstar/drivewise
- GitHub Pages mirror: https://timorningstar.github.io/drivewise/
- Firebase console: https://console.firebase.google.com/project/dtmcleaners/overview
- Firebase Storage: https://console.firebase.google.com/project/dtmcleaners/storage

The Firebase-hosted site is production. The GitHub Pages site is a frontend
mirror that uses the production Firebase API.

## Accounts and Access

- GitHub owner: `timorningstar`
- Firebase project access: Google account `tmstar353@gmail.com`
- Known main full-admin login: `DTMdrive`
- Known daily-use admin login: `drivewise` with the `admin` role
- Recovery login: `ALF`; this account can reset the main full-admin account
  without opening DriveWise records

Verify current account names under the production app's **Admin** tab because a
full admin may change them. Store current passwords and Google account recovery
information in the organization's password manager. Do not put live passwords
or tokens in GitHub, source files, tickets, or this manual.

If the main full-admin password is lost, sign in as `ALF`, reset the main
account, log out, and then sign in with the new temporary password.

## Roles

- `full`: all DriveWise functions, record deletion, and admin-account setup.
- `admin`: all daily repair and accounting functions except admin-account
  setup and repair-record deletion.
- `schedule` (shown as **Repairs only**): create and edit repair and shop supply
  records, upload files, and view records; cannot complete statements.
- `accounting`: view records, check and complete statement invoices, upload a
  missing invoice file, and create payment batches; cannot edit repair details.
- `recovery`: reset the main full-admin account only.

Admin sessions are random bearer tokens stored in browser session storage and
expire after 12 hours. Additional DriveWise admins are created only by a full
admin.

## Applications and Services

- Frontend: React 19 and Vite 8
- Backend: Firebase Cloud Functions, Node.js 24
- Database: Cloud Firestore
- File storage: Firebase Storage
- Source control: GitHub
- Secondary frontend hosting: GitHub Pages and GitHub Actions
- Invoice printing: browser print/PDF workflow, including attached JPG, PNG,
  and PDF invoices

DriveWise does not currently use Postmark, Twilio, Firebase Authentication, or
an external accounting integration.

## Firebase Configuration

- Firebase project: `dtmcleaners`
- Firestore database: `(default)` in region `nam5`
- Hosting site: `drivewise`
- Hosting directory: `dist`
- Functions codebase: `drivewise`
- HTTPS function: `drivewiseApi`
- State application ID: `drivewise`
- Main state document: `appState/drivewise`
- Session collection: `adminSessions`
- Storage folder: `drivewiseInvoices/{repairId}/`
- Storage buckets checked by the backend:
  - `dtmcleaners.firebasestorage.app`
  - `dtmcleaners.appspot.com`

Firebase Hosting rewrites `/api/**` to `drivewiseApi`; all other routes return
the React app's `index.html`.

## Data Model

Most operational data is stored as one state object under
`appState/drivewise`:

- `repairs`: vehicle repair and shop supply records
- `paymentBatches`: completed vendor payment batches
- `regularAdmins`: role-admin account records and password hashes
- `adminCredentials`: main full-admin login and password hash
- `recoveryAdminCredentials`: recovery login and password hash
- `adminLog`: latest 250 recorded administrative actions

A vehicle repair contains:

- Repair date, owner, payer, year, make, model, and needed repairs
- Notes and an optional notes image/PDF
- A stable `vehicleTrackingId` used to associate later repairs with the same
  vehicle
- One or more invoices

An invoice contains vendor, invoice number, part description, positive or
negative cost, attached file metadata, statement selection/completion fields,
and optional payment-batch fields.

A shop supply entry uses the same invoice structure but has `recordType` set to
`shopSupply` and is not associated with an owner or vehicle face sheet.

Invoice and notes files are stored separately in Firebase Storage. Firestore
stores their names, content types, bucket names, and storage paths. Supported
files are JPG, PNG, and PDF, with a 10 MB limit per uploaded file.

## Business Rules

- Vehicle repair date, owner, year, make, model, needed repairs, and at least
  one invoice file are required.
- Shop supply invoice date and at least one invoice file are required.
- Matching year/make/model prompts the user to associate the repair with an
  existing vehicle or track a different vehicle.
- Invoice costs may be negative for returned parts or credits.
- Vendor suggestions come from previously saved invoices, except deliberately
  hidden one-time vendor names.
- Unchecked statement invoices are the default Vendor Invoice View.
- Users may check or uncheck invoices before selecting **Mark complete**.
- Completing a statement records who completed it and when.
- A repair with any completed statement invoice becomes view-only and cannot be
  deleted.
- Only a full admin can delete an unlocked vehicle repair or shop supply entry.
- Statement lists can be printed alone or together with their invoice files.

## Security Model

- Firestore rules deny all direct browser reads and writes.
- Storage rules do not grant public browser access.
- The Cloud Function runs with Firebase Admin SDK privileges.
- Normal state, file, write, delete, statement, and account endpoints check a
  valid DriveWise admin session and the required role.
- Invoice links are one-hour signed Storage URLs or authenticated API downloads.
- API JSON and invoice downloads use no-store/private cache headers.
- Passwords are stored as hashes, not returned by the authenticated dashboard.
- Administrative changes are written to the DriveWise change log.

This is an internal-use security model, not a high-security identity system.
It has no MFA, no automated login throttling, no Firebase Authentication, and
uses a legacy SHA-256 password-hash design. A legacy unauthenticated API state
route also remains in the backend and should be removed before access is ever
opened beyond trusted internal users. Password rotation, limited Firebase
project membership, and keeping the app URL within the organization remain
important.

## Local Development

Original development folder:

`C:\Users\timmo\Documents\Codex\drivewise`

```powershell
cd C:\Users\timmo\Documents\Codex\drivewise
npm install
cd functions
npm install
cd ..
npm run dev
```

Vite normally serves the local app at `http://127.0.0.1:5173/`.

Before deployment:

```powershell
npm run lint
npm run build
node -e "require('./functions')"
```

## Deployment

Sign in to Firebase CLI when needed:

```powershell
npx firebase-tools login
```

Deploy DriveWise hosting and backend together:

```powershell
npx firebase-tools deploy --only hosting:drivewise,functions:drivewise --project dtmcleaners
```

Deploy only the frontend:

```powershell
npx firebase-tools deploy --only hosting:drivewise --project dtmcleaners
```

Deploy Firestore and Storage rules after changing them:

```powershell
npx firebase-tools deploy --only firestore:rules,storage --project dtmcleaners
```

Pushing `main` to GitHub triggers `.github/workflows/pages.yml` and updates only
the GitHub Pages mirror. It does not deploy Firebase Hosting or Functions.

## Backups and Data Safety

Production records are concentrated in `appState/drivewise`, so an accidental
overwrite can affect the entire application. Before bulk data correction or a
schema migration:

1. Export Firestore from the Firebase/Google Cloud console.
2. Preserve the `drivewiseInvoices/` Storage folder.
3. Record the active Git commit and deployment date.
4. Test migration code against a copied document whenever practical.

The purge endpoint deletes repair and payment-batch records from Firestore but
does not serve as a backup or rollback mechanism. Do not use it on live data.

## Routine Release Check

1. Confirm each role sees only its intended menus and actions.
2. Save a test repair with an image and a PDF invoice.
3. Open both invoice types from Vendor Invoice View.
4. Verify a negative invoice cost displays and totals correctly.
5. Check, uncheck, print, and complete a statement selection.
6. Confirm completed records are view-only.
7. Verify vehicle and vendor record views sort correctly.
8. Check Shop Supplies entry, record listing, and full-admin deletion.

Review backend errors with:

```powershell
npx firebase-tools functions:log --project dtmcleaners
```

## Recovery Notes

- Login failure: verify the account name and role in **Admin**, then check
  `drivewiseApi` logs and the `adminSessions` collection.
- Missing invoice: verify the Firestore file metadata and corresponding object
  under `drivewiseInvoices/{repairId}/` in Firebase Storage.
- PDF will not display: test the authenticated file URL and content type, then
  confirm the file exists in the recorded bucket.
- Record cannot be edited: check whether any invoice has
  `statementComplete: true`; this intentionally locks the whole record.
- Bad release: correct or revert the source through Git, run the checks above,
  and redeploy. Do not overwrite or delete Firestore data to roll back code.
