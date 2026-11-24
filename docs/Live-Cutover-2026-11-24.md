# DriveWise live workflow

Released November 24, 2026.

- Staff: https://drivewise.web.app — or open DriveWise from https://dtmapp.web.app. Existing Hub App Access roles and legacy local logins are retained.
- Customer request: https://drivewise.web.app/#apply. This is the production form. The external downtownmin.org website itself was not edited during cutover; its link/embed can be updated to this URL.
- The old testing address redirects to production. Its database remains isolated for archival/rollback; its two scheduled email jobs are paused.

The application → eligibility → diagnostic appointment → diagnostic results or completion → saved charge → mechanic assignment → completion/payment workflow is now the production default. Friday 4 PM Indiana booking cutoff, capacity of one per configured time, required mechanic hours/invoice or explained no-parts exception, Reply-To routing, corrections and invoice reversal history are retained. Production emails/PDFs do not carry test branding; notification sender remains unchanged. Setup retains the latest tested recipient, mechanic and schedule configuration. Review Setup when changing operational recipients; Friday recipient remains T1 as previously configured.

## Preserved data

100 original records retained in the existing dtmcleaners appState/drivewise document: 92 vehicle repairs and 8 shop-supply records. Vehicle repairs already had historicalComplete; only workflowStatus=complete was added. Every prior field, invoice, file reference, customer/payment state and account setting was compared and preserved. No completion dates, mechanic hours, balances or payments were invented. No historical notification was queued. No test customer, work order, ledger, attachment, mechanic link or outbox was imported. Configuration alone was copied from testing. Existing production Program Metrics integration remains active.

A fresh current-Windows-user DPAPI backup includes all original operational documents and 150 file objects. Encrypted readback and stable source versions verified; matching copy is in OneDrive/DTM Protected Backups/DriveWise. Recovery requires the original Windows user/profile. Files and object generations were unchanged after cutover. Exact private paths and migration checks are recorded in shared project CURRENT/OPERATIONS, outside GitHub customer data.

## Deployment and rollback

Production configuration is root firebase.json/functions and normal npm run build; project dtmcleaners, account tmstar353@gmail.com. Hub and shared handoff service remain in dtm-housing using T1. Do not redeploy testing/firebase.json as production. testing/retired.firebase.json maintains the former testing URL redirect. Testing data is retained separately and must not be restored over production.

For rollback, retain pre-cutover code efa818b plus earlier production Hosting release, encrypted snapshot and current post-cutover data. Capture all new production changes before any rollback; never replace current appState with the testing state. The in-place migration changed only historical workflow status and added workflow configuration. Reversing the code route does not require deleting preserved historical records.

Private invoice URLs require the production runtime to sign its own short-lived URLs. The custom IAM role projects/dtmcleaners/roles/drivewiseBlobSigner grants only iam.serviceAccounts.signBlob on the runtime's own service account. No storage object was made public and no key file was created.

## Verified release

Production/source tests:77 passed; Hub:24 passed; targeted handoff/mail:8 passed. Authenticated live verification succeeded (execution7j568): current Hub grant checks, live PKCE round trip/replay denial,100 original records/92 completed historical repairs/8 shop supplies, no pending/live test records, three real private invoice downloads, current T2/Accounting grants enforced, Accounting create/settings denied, anonymous state denied and invalid intake rejected. Verification made no business writes and sent no emails. Temporary verification job removed. Shared relay00040-ng6 serves100% traffic, service/revision max1. Production bundle index-DGNgAokV.js; Hub main.2434fd7d.js. All150 original object generations remained unchanged.

## Scheduled backup coverage added November 24

Production DriveWise is now part of the central encrypted DTM app archives together with Housing, Work Orders, Program Metrics, shared login recovery data and Hub access settings. The same six-hour, daily and weekly schedule and7/14/98-day retention apply. Current DriveWise Firestore documents, local account recovery fields, financial/audit history and actual private uploaded bytes are included; the archived test app is excluded. The Hub Backup Status screen explicitly shows whether each snapshot includes DriveWise. Older snapshots retain only their prior coverage. Source engine/runbook: dtm-hub/operations/app-backups, separate cloud backup project. Recovery verification reconstructs an isolated in-memory database and validates file bytes; it does not modify production. Final cloud execution proofs are recorded in shared CURRENT.
