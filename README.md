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
