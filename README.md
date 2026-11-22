# DriveWise

Downtown Ministries DriveWise vehicle repair, shop supply, invoice and payment application.

Live DriveWise admin: https://drivewise.web.app
GitHub Pages mirror, after repo setup: https://timorningstar.github.io/drivewise/

## Run it

```bash
npm install
npm run dev
```

Open the local URL Vite prints, usually `http://127.0.0.1:5173/`.

## Included workflows

- DriveWise repair face sheets
- Vehicle, repair, vendor, invoice, part, and cost tracking
- Vendor statement check and payment status workflow
- Printable invoice/payment view
- Role-based admin access for full, schedule, and accounting accounts

## Firebase

This app deploys to the existing `dtmcleaners` Firebase project.

- Hosting site: `drivewise`
- Public directory: `dist`
- State app id: `drivewise`
- API rewrite: `/api/**` to the dedicated `drivewiseApi` Cloud Function
- Firestore document: `appState/drivewise`

## Admin

Admin URL: https://drivewise.web.app

Default main full-admin:

- Login: `admin`
- Password: `fair2026`

Recovery full-admin:

- Login: `ALF`
- Password: `GreenTree53`

Recovery access can only reset the main full-admin account. It cannot manage
schedules, role admins, DriveWise records, or demo data. Its
reset action is logged as `ALF` in the change log.

Full admins can create schedule, accounting, or additional full-admin accounts.
Schedule admins can maintain repair records. Accounting admins can review
invoices, statement checks, and payment batches.

Deploy:

```bash
npm run firebase:deploy
```

## GitHub

The repository is prepared for `timorningstar/drivewise`.

```bash
git remote add origin https://github.com/timorningstar/drivewise.git
git push -u origin main
```

GitHub Pages is configured through `.github/workflows/pages.yml`. The Pages
build uses the Firebase-hosted API at `https://drivewise.web.app`, so the
GitHub mirror can run without Cloud Functions on GitHub.

## Next build step

This app now deploys its own Firebase Functions codebase and Hosting rewrite,
separate from DTM Meal Signup.


## DTM Hub and mechanic workflow upgrade — November 21, 2026

Open https://dtmapp.web.app and choose DriveWise. Hub uses the shared DTM Firebase/Microsoft identity; current app-specific DriveWise access is checked by the backend on each request. Source Firestore `appState/drivewise` and private Storage remain in `dtmcleaners`; no records were migrated or cleared. Existing DriveWise username/password logins remain available during rollout. Back to DTM Hub keeps the Hub login; Hub sign-out clears DriveWise through the shared logout chain.

Hub App Access provides Full Admin, Repairs only and Accounting; select both ordinary permissions for the repair-through-payment workflow. Full Admin manages DriveWise access in Hub without changing another app's roles. Initial authorized grants: T1 Full Admin; accounting@downtownmin.org Accounting only; T2 (tim@tjmstar.com) Repairs and accounting temporarily, with no automatic expiry requested. The new Accounting DTM login can set its password using Forgot your password? in Hub; connecting Microsoft follows the existing DTM account-link process. No mailbox was created and no password/reset email was sent by this setup.

### Send a repair to a mechanic

Create a vehicle repair request before an invoice is available; leave invoice details blank. Actual invoice entries still require a file; shop supplies still require an invoice. Saving a new vehicle request opens Share mechanic repair link. Existing vehicle records have Share with mechanic and Revoke link actions. Copy the link or use Email repair link to open your email composer. Creating another link replaces the previous one. No email is sent automatically.

The mechanic can open that one repair without an account for **30 days**, return multiple times, add repair notes, take phone photos or upload saved JPG/PNG/WebP/PDF files (4.5 MB each; 24 attachments per repair), and mark the repair complete with their name. Select files and choose Upload selected files; uploaded filenames remain visible. An incomplete transfer can be retried without duplicating an accepted attachment. Named completion and the mechanic's notes/files appear on the staff vehicle record under Mechanic updates and attachments. Invoice/accounting details and payment entry remain with staff. Staff reviews uploaded invoices before entering accounting details through the existing process.

Mechanic links are random capabilities stored only as hashes server-side, scoped to one existing vehicle repair, expire after 30 days, and can be replaced or revoked. Financial fields, payer details, other repairs and admin screens are excluded from the mechanic response. Progress is stored separately in `drivewiseMechanicWork`, link hashes in `drivewiseMechanicLinks`, and uploads privately under `drivewiseInvoices/{repairId}/mechanic-*`. Existing repair/invoice/account data is not rewritten by mechanic updates.

### Preservation and verification

Before deployment, an encrypted Windows DPAPI recovery copy was verified for all 100 existing records and 150 uploaded files. Business records/accounts and original file generations/hashes were verified unchanged after the Hub pilot; only a normal legacy login audit entry was appended. The recovery copy is bound to the current Windows profile, not a portable or scheduled cloud backup. The Housing/Airtable backup jobs do not yet cover DriveWise's separate Firestore/Storage data; include new mechanic collections when adding scheduled DriveWise backups. No real repair, mechanic completion, payment or mechanic link was created for testing.

Legacy unauthenticated API state export was removed: `/api/state` now requires authentication and returns sanitized app state, while API root returns only health metadata. Tests cover Hub role separation; mechanic scope, expiry, replacement/revocation, name validation, upload format validation, idempotent retries and preservation of source/payment data. Use `npm run lint`, `npm run build` and `node --test functions/hub-access.test.js functions/mechanic.test.js`. Private local synthetic UI checks exercised completion and invoice upload.

## Existing repairs completed — November 21, 2026

The owner confirmed all original vehicle repairs were already complete. Marked the 92 original vehicle repair records as historical complete/read-only; eight shop-supply records were left unchanged. Original details, notes, invoices, payment/status flags, IDs and files were preserved. No actual completion date or mechanic name was inferred. Completion metadata records when this administrative confirmation was entered, not when the repair occurred.

Historical completed repairs display Repair complete and View, with no Share/Revoke/Edit/Delete actions. Backend edit/delete and mechanic-link issuance/access are blocked as well. This does not mark invoices paid, finish vendor statements, or close future repair requests. A readback check confirmed all original record content and other state sections unchanged apart from the explicit completion metadata; a protected pre-change recovery copy was verified.

The five workflow menus remain current: New Repair Record, New Shop Supplies, Vehicle Repair Records, Shop Supplies Records and Vendor Invoice View. The legacy Admin menu is hidden for Hub sessions, which use App Access in DTM Hub; it remains available for authorized legacy account maintenance.

## Permission-based menu visibility — November 21, 2026

New Repair Record and New Shop Supplies appear only for users with repair-entry permission (Full Admin, Repairs only, or Repairs and accounting). Accounting-only users see Vehicle Repair Records, Shop Supplies Records and Vendor Invoice View, with accounting actions available according to their permissions. Entry forms and backend checks retain the same restrictions. Refresh DriveWise after changing a Hub grant to load the current role.

Tim reports T2 was changed to Accounting only in Hub; this supersedes the initial temporary combined grant recorded above. No grants were changed by this menu fix.

Accounting users can select **Vehicle Repair Records → View** to open the read-only face sheet, needed repairs/work notes, and saved invoice links/previews. Mechanic notes/completion and uploaded attachments remain available on the repair list. Detail fields are disabled and repair creation, editing, sharing, and saving remain restricted to repair-entry roles. Accounting payment/invoice processing permissions remain unchanged.

Shop Supplies Records has independent Vendor and Statement filters, defaulting to All vendors / Unchecked. Statement options are All invoices, Unchecked, Selected for payment (checked but not completed), and Statement complete. Vendor choices include only shop-supply vendors. Filters apply to individual invoices, preserve date ordering, and show an explicit empty message. Regular invoice-view filters and payment processing remain unchanged.

## Customer balances and completion notifications — November 22, 2026

Document workflow items 4–6 are implemented separately from vendor payments. For a new vehicle repair:

1. Use **Customer payments**, choose the vehicle repair, and save the **agreed total customer charge**. This is the amount the owner/designated payer owes, entered by staff; vendor invoices do not set it automatically. An explicit 0.00 means no customer payment is due. An unset charge never automatically closes a repair.
2. Record each amount received, date, received-from name and optional check/method/reference. Partial payments reduce the balance. Exact integer cents, transaction validation and stable payment IDs prevent rounding errors, overpayments and duplicate retries.
3. Mechanic completion automatically queues a completed-work notification. Every customer receipt or reversal queues a payment notification. Emails contain repair/work/invoice summaries and the balance, with a permanent repair link requiring an authorized DTM login to open saved files. They do not contain anonymous mechanic capabilities or public invoice URLs.
4. A repair closes only when the mechanic has completed the work and the agreed customer balance is zero. Closed repairs remain available under Vehicle Repair Records → View. Closure does not mark vendor invoices paid or complete vendor statements.
5. Accounting/Full Admin/combined-role staff can reverse an incorrect payment with a reason. Original entries are retained, the balance is recalculated, the repair reopens when money is owed, and a correction notification is queued. Staff can correct the agreed charge; it cannot be reduced below net payments received. All changes retain an audit/history. Records with customer account history cannot be deleted.

Full Admins use **Notifications** to set up to eight addresses and retry pending delivery. Initial test recipient is **t1@downtownmin.org**, as selected by Tim; switch/add Accounting when ready. The sender is the existing **notification@downtownmin.org**. Recipients need DriveWise access to open the protected repair and invoices. Saved pending events retain their original recipients; changed settings apply to future events. Retrying emails does not repeat customer receipts.

New source Firestore collections are `drivewiseCustomerAccounts`, `drivewiseNotifications` and `drivewiseSettings`. They retain separate customer ledgers, durable event snapshots/leases and recipient settings. Completion plus outbox creation and customer receipt plus outbox creation use Firestore transactions. Scheduled `drivewiseNotificationRetry` runs every 15 minutes; failed delivery remains pending and visible to Full Admins. Existing 92 historical completed vehicle repairs do not acquire balances, new payments or retrospective completion emails. Original `appState/drivewise` and vendor workflows remain intact.

Mail is relayed over verified Google service identity to the shared DTM backend, reusing its Microsoft cloud-federated sender and stored draft IDs for safe retries. No new expiring mailbox password or long-lived application secret was added. The relay accepts the known DriveWise runtime identity and expected audience; browser Firebase tokens cannot invoke it. Microsoft draft/send delivery recovery lives in encrypted shared store records prefixed `drivewise-mail:`.

Validation: `npm run lint`, `npm run build`, `node --test functions/*.test.js` (19 tests). Shared backend suite has 26 tests. Local browser sample verified a $100 charge paid in $40/$60 installments, zero balance and closure. Sample mail tests are explicitly labeled and do not create repair/payment records. Scheduled cloud backups for separate DriveWise source data remain a future task; include the new collections as well as original state, mechanic work/links and private files when configuring them.


## Work Orders style dashboard and streamlined requests — November 22, 2026

DriveWise now uses the same navy header, gold accent, light background, summary cards and compact navigation as DTM Work Order Repair. All signed-in operational roles initially open **Open repairs**. Cards show open and completed work, total customer balances due, and unchecked invoices. **Completed** retains finished repairs; **All vehicle records** retains the complete history and By vehicle/By vendor views. Completing repair work and clearing its customer balance remain separate states. Customer payments, Vendor invoices, Shop supplies and Full Admin Notifications retain their functions. Accounting-only users get view/accounting functions and no creation buttons; Hub App Access remains in Hub. The same styling is used for sign-in so the old Invoice Admin/Dashboard layout is no longer rendered.

Use **+ New repair** to enter a request. The NEW form excludes Parts and invoices, requires **Payer**, and includes **Agreed charge ($)**. Enter a known agreed charge, enter 0.00 if no payment is due, or leave blank until agreed and enter it later in Customer payments. Saving a new request and an initial charge is atomic and preserves existing records from a fresh database read. **Save and share with mechanic** automatically opens the existing 30-day link window with Copy/Email options. Repeated clicks are guarded, and sharing also opens when retrying a draft after a save error. No email is automatically sent when creating a mechanic link; the Email option opens the mail composer.

Saved record views retain invoices and attachments; existing historical records and shop-supply invoice requirements are unchanged. To enter supplies, open **Shop supplies**, then use **+ New shop supplies**. The contextual creation button is restricted to repair-entry roles.

Verification includes 19 service tests, actual rendered form/role/dashboard checks, and isolated browser checks of default navigation, payer validation, new repair → automatic link dialog, Completed history, shop entry, and Accounting-only access. No production repair, payment, mechanic capability or outgoing email was created for these UI/form tests. Screenshot dashboard-sample-2026-11-22.png uses synthetic sample data. Hosting serves index-TGEpqmoe.js with no-store HTML; old Invoice Admin and Invoice Dashboard titles are absent from the deployed bundle.
