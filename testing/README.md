# DriveWise Testing

Deployed November 22, 2026. This is the separate new-workflow pilot, with no production customer records imported.

| Entry | URL and purpose |
|---|---|
| Staff | https://dtm-drivewise-test.web.app — open from DTM Hub using the existing DriveWise App Access grant |
| Test application form | https://dtm-drivewise-test.web.app/#apply — creates a pending request directly; no customer login |
| Existing live app | https://drivewise.web.app — preserved, with its existing local logins and real records |
| Hub | https://dtmapp.web.app — DriveWise Testing replaces the old DriveWise card |

The public downtownmin.org website form is unchanged at Tim's explicit direction. Do not point it at testing. At rollout, connect its form/link/embed to the production successor only after verifying intake and migration.

## Staff workflow

1. Review **Pending requests and diagnostics**. A website application or staff-created application creates a pending request, emails an application copy to `carapp@downtownmin.org`, and notifies `carrepair@downtownmin.org`.
2. Save the staff eligibility decision first. A not-eligible decision requires a reason and retains the request/history. Eligible requests remain pending until an appointment is entered. Contact the customer offline. Select the request and record the agreed Monday diagnostic date and **3:30, 3:50 or 4:10 PM**, Indiana local time. The app does not book appointments for the customer. Staff must coordinate slot capacity offline.
3. Each Friday at **4:00 PM Indiana time**, the app queues one email listing the coming Monday's names and times, with a printable diagnostic PDF containing the demographics, repair request, and writing lines for diagnosis and parts. During testing, Stephanie's recipient is **t1@downtownmin.org**. No email is generated for an empty appointment list. Manual send is available in Workflow settings; duplicate sends for the same Monday are prevented.
4. Todd/Stephanie emails the completed PDF to carrepair. Staff records the diagnostic notes and parts in the app; incoming email/PDF extraction is not automated.
5. Open **Customer payments** and set the agreed charge, including an explicit `0.00` when nothing is owed. Record full or partial receipts when received. An agreed cost is mandatory for live mechanic assignment; receiving payment is optional. Payments and reversals notify Accounting and preserve history.
6. After eligibility review, diagnostic appointment and diagnostic results are recorded, choose an active mechanic and select **Make live and email mechanic**. Assignment, the new link, and its durable email event commit together. The mechanic receives the one-repair phone link automatically. Reassigning/reissuing replaces the former link.
7. The mechanic needs no account. They can save notes/hours, take receipt photos, upload multiple images/PDFs, and mark complete with their name. Upload selected files before completion. The link expires after 30 days **or immediately on completion**. A completion acknowledgment is shown, and later visits are denied.
8. If fixed during diagnostics, staff can enter the maintenance person's name, hours and notes and complete directly. Charge entry is still required. Completion sends details to carrepair; work completion and customer balance closure remain separate.

Existing vehicle/supply records, invoices, statement dates, double-confirmed verification reversals, invoice moves, correction history and customer payments remain available in the pilot's corresponding views. Production historical data has not been reset or seeded into the test app.

## Access and notifications

The shared `drivewise` App Access directory is authoritative. No user grants were changed. Full Admin manages workflow settings/mechanics and Hub access; Repairs-only users enter/manage repairs; Accounting users retain authorized record/invoice/payment access without repair creation or configuration. Both permissions may be combined in Hub. Every API request checks the current grant.

Full Admin: **Pending requests and diagnostics → Workflow settings** manages mechanic names/emails and application, repair, accounting and diagnostic recipients. Initial mechanic: Tim Morningstar, `tim@tjmstar.com`.

**Only Stephanie's diagnostic recipient is redirected to T1.** Other configured addresses are real recipients by Tim's instruction: carapp, carrepair, accounting and the selected mechanic. Every test email subject identifies **DTM DriveWise TEST**. A 15-minute scheduled retry retains failed delivery events. Public form anti-abuse checks include expiring, IP-bound submission challenges, rate limiting and a honeypot. Staff entry requires sign-in.

## Isolated deployment

Firebase/GCP project: `dtm-drivewise-test`; Hosting site: `dtm-drivewise-test`; Firestore: separate default database with deletion protection; private uploads: `dtm-drivewise-test-files`. Direct client Firestore access is denied. Dedicated runtime: `drivewise-test-runtime@dtm-drivewise-test.iam.gserviceaccount.com`. It has no production DriveWise Firestore/Storage access. Firebase login identity remains the shared `dtm-housing` identity; backend grants remain centralized.

The test backend source is **testing/functions**, an independent copy of the existing operational modules with the new intake workflow and test-specific security/notification behavior. The root functions folder targets the existing app; publishing test work must use the testing configuration. Shared React components use `VITE_DRIVEWISE_TESTING` only in the test build. The root production Hosting/Functions were not redeployed for this pilot.

From the repository root:

```powershell
npm run build -- --config testing/vite.config.js
node --test testing/functions/*.test.js
firebase deploy --config testing/firebase.json --only 'hosting,functions:drivewise-test,firestore:rules' --project dtm-drivewise-test --account t1@downtownmin.org --non-interactive
```

Run `npm ci --prefix testing/functions` if test backend dependencies are missing. Preserve its lockfile. Container images have a seven-day cleanup policy. Friday digest uses `America/Indiana/Indianapolis`; retry schedule runs every 15 minutes.

## Preservation and eventual rollout

Before the rebuild, the live source was captured into a protected encrypted snapshot: 100 repairs/supply records, 150 uploaded files, and the mechanic-work/link documents present at capture; newer account/notification/settings collections were enumerated and empty. Restoration of all saved documents and all file bytes into isolated temporary test paths was verified, followed by cleanup. Production source writes were zero. Recovery details and private archive locations are in the shared DriveWise CURRENT/OPERATIONS notes, not this repository.

The live app continues receiving real work. At cutover, capture a fresh consistent snapshot, rehearse schema conversion/restoration into a restricted destination, reconcile all newer live records/files, preserve historical completion/invoice/payment/audit fields, discard test transactions separately, and then switch Hub/website routing. Do not fabricate old email, class-attendance, hours or payment data, or send retrospective notifications. Keep the old deployment and rollback copy until reconciliation passes. Test data is intentionally excluded from production Program Metrics.

The existing central Housing/Work Orders/Programs backup screen does not imply coverage of the separate DriveWise projects. Scheduled DriveWise backup coverage remains separate work; the completed rebuild snapshot is a verified point-in-time recovery copy.

New applications do not count as live repairs. The dashboard separates Pending requests / diagnostics from Live repairs. Pending emails state PENDING, give the staff review/contact/appointment steps, and open the specific application after shared sign-in. No mechanic link is issued on application submission. The customer application hides Payer; its saved default is the customer name, with later staff correction available.
