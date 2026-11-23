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

1. Review **Pending requests and diagnostics**. A website application or staff-created application creates a pending request and one combined notification to the **Car Repair Requests** recipients configured in Setup.
2. Save the staff eligibility decision first. A not-eligible decision requires a reason and retains the request/history. Eligible requests remain pending until an appointment is entered. Contact the customer offline. Select the request and record the agreed diagnostic date and time from the schedule in **Setup** (initially Monday at **3:30, 3:50 or 4:10 PM**), Indiana local time. The app does not book appointments for the customer. The app permits only one request per diagnostic date/time slot, including simultaneous staff saves.
3. Each Friday at **4:00 PM Indiana time**, the app queues one email listing the next configured diagnostic day's names and times, with a printable diagnostic PDF containing the demographics, repair request, and writing lines for diagnosis and parts. During testing, Stephanie's recipient is **t1@downtownmin.org**. No email is generated for an empty appointment list. Manual send is available in Setup under Diagnostic email controls; one manual send per appointment date is allowed, separately from Friday’s automatic email. A manual send does not suppress Friday’s updated list; duplicate retries within each mode are prevented.
4. Todd/Stephanie emails the completed PDF to carrepair. Staff records the diagnostic notes and parts in the app; incoming email/PDF extraction is not automated.
5. Open **Customer payments** and set the agreed charge, including an explicit `0.00` when nothing is owed. Record full or partial receipts when received. An agreed cost is mandatory for live mechanic assignment; receiving payment is optional. Payments and reversals notify Accounting and preserve history.
6. After eligibility review, diagnostic appointment and diagnostic results are recorded, choose an active mechanic and select **Make live and email mechanic**. Assignment, the new link, and its durable email event commit together. The mechanic receives the one-repair phone link automatically. Reassigning/reissuing replaces the former link.
7. The mechanic needs no account. They can save notes/hours, take receipt photos, upload multiple images/PDFs, and mark complete with their name. Upload selected files before completion. The link expires after 30 days **or immediately on completion**. A completion acknowledgment is shown, and later visits are denied.
8. If fixed during diagnostics, staff can enter the maintenance person's name, hours and notes and complete directly. Charge entry is still required. Completion sends details to carrepair; work completion and customer balance closure remain separate.

Existing vehicle/supply records, invoices, statement dates, double-confirmed verification reversals, invoice moves, correction history and customer payments remain available in the pilot's corresponding views. Production historical data has not been reset or seeded into the test app.

## Access and notifications

The shared `drivewise` App Access directory is authoritative. No user grants were changed. Full Admin manages workflow settings/mechanics and Hub access; Repairs-only users enter/manage repairs; Accounting users retain authorized record/invoice/payment access without repair creation or configuration. Both permissions may be combined in Hub. Every API request checks the current grant.

Full Admin: the main **Setup** menu manages Car Repair Requests (up to three recipients), Accounting, Friday diagnostics, DriveWise contact email and mechanic names/emails. Initial mechanic: Tim Morningstar, `tim@tjmstar.com`.

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


## Denied requests, customer replies and reconsideration (November 23)

Denied requests are retained, not deleted. In Pending requests and diagnostics, choose **Show → Not eligible / denied**, then select the person. Denied requests do not count as live repairs or diagnostic appointments, and neither the screen nor the PDF API allows a diagnostic PDF while denied.

Staff eligibility review separates **Internal eligibility notes** from **Message to customer**. When a customer email exists, **Email this decision … when saved** is selected initially; staff can edit the outgoing message or uncheck it before saving. Saving the decision and its email event is atomic. Internal notes, class participation details, vehicle details and diagnostic PDFs are not included in a customer decision email. The supplied customer email is optional, but a supplied address must be valid. Without an address, the decision can still be saved and no customer email is sent.

For an already saved decision, review the message and use **Email current decision**. This records an email action without changing eligibility. The app shows the queued destination/time, retains failures for scheduled retry, and prevents duplicates on a submission retry. Test messages continue to carry TEST in their subject. Existing denied records are not automatically emailed when this feature is deployed.

To reconsider, change **Staff decision** to **Eligible — arrange diagnostics**, edit the customer message or disable email if appropriate, and **Save eligibility decision**. The request returns to eligible/pending so staff can arrange a new diagnostic appointment. An old diagnostic appointment is cancelled rather than silently reactivated. Decision notes, previous decisions and prior appointment references remain in history. Superseded queued decision messages are cancelled instead of delivering an obsolete denial after reconsideration. Diagnostic digests also omit requests denied after the email was queued.


## Setup and Car Repair Requests (November 23)

The pictured yellow TESTING information box has been removed from the staff workflow. **Setup** is a main navigation item for Full Admins; it replaces the old inline Workflow settings button. Other users do not see it, and the server retains its Full Admin-only settings guard.

**Car Repair Requests** has three email slots (first required, two optional). Use individual recipients to manage membership directly in the app, without updating an Exchange distribution list. Addresses are validated, normalized and deduplicated; more than three is rejected. New customer applications now create one pending-request event addressed to this group, replacing the separate application-copy and pending emails. Completed repair notices use the same group. Accounting payment notices, Friday diagnostic list and DriveWise customer contact email are configured separately. Mechanic assignments still go directly to the selected mechanic.

Tim elected to retain the existing carapp and carrepair list addresses initially; no individual member addresses were supplied. Setup reads the previous settings into those two slots without discarding custom recipients or mechanics. Replace them with up to three individual emails and choose **Save setup** when ready. This changes the test app's future delivery destinations; it does not modify or delete any Microsoft Exchange distribution list or change the current public website.

Existing queued emails retain the recipient snapshot with which they were created. Changing Setup does not resend old requests or redirect already queued messages. Recipient settings and mechanic records are stored in the existing protected test workflow settings document. No request, eligibility decision, balance, payment or shared login permission changes when saving Setup.


## Configurable diagnostic schedule (November 23)

Full Admins can open **Setup → Diagnostic schedule**, choose any day of the week, edit the appointment times, and add or remove times (one to 24 distinct times). Choose **Save setup**. Times use Indiana local time; the initial defaults remain Monday at 3:30, 3:50 and 4:10 PM. Duplicate, missing or invalid times are rejected.

Staff scheduling then shows that weekday and the saved times. Staff still contacts the customer offline, chooses a date on the configured weekday, selects a time, and saves the appointment. The server checks the current saved schedule, including when an older staff screen is still open. Settings changes do not move or cancel previously booked appointments; their saved date/time remains visible. To reschedule, choose a date/time allowed by the current settings.

The automatic diagnostic email still runs Friday at 4:00 PM Indiana time. Its target is the next occurrence of the configured diagnostic weekday after the run date (a Friday diagnostic setting targets the following Friday). Its subject no longer assumes Monday. Setup's manual diagnostic email control accepts any actual appointment date, including an older booking retained after changing the weekday. Existing queued emails keep their snapshots; changing the schedule does not resend them. If changing the diagnostic weekday while appointments are already booked, review those bookings and use the manual date-specific list for any retained old date as needed.


## Compact navigation (November 23)

Normal sign-in opens **Pending Requests**. Select the summary boxes to open Pending Requests, Live repairs, Completed repairs, Customer balances due. The active box has a gold indicator and each box displays Open. Specific-request links still open their intended record.

The remaining compact menu is **All vehicle records**, **Finance**, and **Setup** (Full Admin only). Finance opens Vendor invoices and groups **Vendor invoices**, **Shop supplies** and **Customer payments** in one contextual menu. Repair-authorized staff can also create shop supplies there. Accounting-only users retain their existing record/invoice/payment access without repair creation or Setup privileges. The Customer balances due box is a direct Finance shortcut. Vendor invoices are accessed through Finance; the Unchecked invoices summary box has been removed. The long duplicate navigation row is removed in the Testing app.


## Denied requests in Customer payments (November 23)

Denied requests with no agreed charge or financial history are excluded from the Customer payments repair selector. Denial remains recorded under Pending Requests → Not eligible / denied; nothing is deleted. If a denied request already has a saved charge, payment or account audit history, Finance retains it for review and permitted payment reversals, with an explicit denied/history-only status. New charges and payment receipts are disabled in the screen and blocked on the server until staff reconsiders eligibility. A recorded zero-dollar charge is still financial history.


**All vehicle records** lists actual live/completed repairs and legacy repair history, excluding pending, diagnostic-stage and denied applications. To review a denied application, choose the **Pending Requests** summary box, then **Show → Not eligible / denied**. Select the requester to review the decision/history or reconsider eligibility. Denied applications remain retained; these screen filters do not delete any record.


The Pending Requests **Show** filter contains only **Requests and diagnostics in progress**, **Pending requests**, and **Not eligible / denied**. Completed repairs and All applications have been removed from this dropdown. Use the Completed repairs summary box or All vehicle records navigation for actual repair history.


## Completed repair Date Range (November 23)

Open the **Completed repairs** summary box and use **Date Range → From / Through**. Both endpoints are included; either can be left blank for an open-ended range. **Clear dates** restores all completed repairs. The filter applies before grouping, so both By vehicle and By vendor use the same date range. It uses repair completion date in Indiana local time, falling back to the recorded repair date for older records without a completion timestamp. Invalid reversed ranges show a message and no matching results. Filtering does not change records or the overall Completed repairs summary count.


## In Diagnostics summary box (November 23)

**In Diagnostics** counts requests with a scheduled diagnostic appointment that have not completed diagnostics, been denied or completed the repair. Click the box to open the request workflow filtered to **In Diagnostics**. The same choice is available in Show. After staff saves diagnostic results, the request moves to awaiting repair decision and leaves this count. Pending Requests remains the default opening view and its combined in-progress view still includes diagnostic requests.


Staff application entry uses the **+ New request** button at the top of DriveWise. The duplicate **+ New application** bar inside Pending Requests has been removed. The **Customer application form** link remains available for customer self-entry without sign-in.


## Available diagnostic dates and one appointment per slot (November 23)

The diagnostic date field is an available-date dropdown instead of an unrestricted calendar. It lists only the configured weekday with at least one available appointment time. New bookings default to the earliest available date/time, considering today's remaining slots in Indiana local time and skipping elapsed times or full dates. Staff still arranges the appointment with the customer before saving it. Dates are offered for the next two years.

Booked slots do not appear for other requests. The currently edited request does not block its own slot. The server rechecks both current Setup and all bookings in the same transaction, so only one of two competing bookings can succeed; the other staff member must refresh and choose another slot. Denied/cancelled requests release their appointments; rescheduling releases the previous slot. Completed appointments retain their historical reservation. Existing saved appointments are displayed and are never moved automatically; changing a default or opening a form does not book anything.


## Diagnostic email wording and printable writing space (November 23)

Diagnostic list subject is **DTM Car Diagnostic Monday** (weekday derived from the appointment date). The body begins **Monday, November 30**, then customer names and appointment times in AM/PM format. Indiana-time clarification and the Testing notice follow the list. PDF attachment retained; Diagnostic notes and Parts ordered each have five lines with increased handwriting spacing (1.8 times prior vertical spacing), one page per ordinary customer request. This formatting update does not send any email by itself. Manual and Friday scheduled deliveries have independent duplicate protection for each appointment date.


## Early manual send plus Friday automatic delivery (November 23)

Tim clarified that an early manual email must not prevent the Friday email. **Send diagnostic list once** allows one manual email for the selected date, while Friday at 4 PM independently builds and sends the latest appointment list for the next diagnostic day. Each delivery mode prevents repeated submissions/retries for its own date. The November 30 manual list already sent does not block Friday November 27's automatic list. Legacy delivered manual events are recognized by the manual button so upgrading does not resend them; the new scheduled mode is independent. No appointments means no automatic email. This is not an unrestricted resend button.


## Required charge before mechanic assignment (November 23)

In step **4. Send live work order to mechanic**, enter the required **Agreed charge ($)** and choose **Save agreed charge**. The mechanic selector and Make live button remain disabled until a charge is saved. Enter **0.00** explicitly when no customer payment is owed. The saved charge is shown in this step; Customer payments remains available for later corrections. A payment receipt is optional. The existing server transaction independently rejects activation without a saved charge, so the requirement cannot be bypassed through the screen. Saving the charge alone does not assign a mechanic or send the mechanic email.


## Guided steps and repairs completed at diagnostics (November 23)

A progress panel above each request names the next action and shows the four stages. **Next step** is highlighted in gold and opens automatically. **Completed · Edit** steps are shaded gray and can be opened to correct details. **Upcoming** shows what follows. Color is reinforced by text labels. Denied requests show their retained status; live work shows that the order is with the mechanic.

In **Step 3 → Diagnostic results and parts**, select **Repair completed during diagnostics** when no later mechanic assignment is needed. Enter diagnostic/repair notes, parts, the freeform name of **Who did the repair?**, and approximate hours. If there is a charge, select **There is a charge for this repair**, enter the amount and **Who pays?** (initially the customer, editable). If no charge is selected, the app explicitly records $0.00. Saving completes the repair and saves the charge/payer/work details together; no mechanic assignment/link is created. Payment can be recorded later in Finance. A positive unpaid charge remains an outstanding balance even though the repair work is complete. Existing payments are retained; an agreed charge cannot be reduced below payments already received.

Correcting earlier eligibility notes, appointment or diagnostic results preserves a live/completed repair's current stage and mechanic link, and records history. An eligible review for a live/completed repair can be corrected but cannot be changed to denied through this form. Existing appointment reservations remain protected. Completed repairer/completion/invoice corrections continue through **Completed repairs → Reopen for corrections**; prior financial history is retained. Changing the assigned mechanic or replacing their link remains an explicit staff action.


## Mechanic email and work form (November 23)

Mechanic assignment emails omit DTM class attendance and the staff-only pending-request/sign-in link. A blank line separates the repair description from **Mechanic work order**. Staff pending-request emails retain their eligibility/class details and sign-in link. This change does not resend existing messages.

The mechanic work form labels the name field **Mechanic:** and prefills the assigned recipient's name; the mechanic can correct it before saving/completing. **Diagnostic notes** and **Parts ordered** are displayed when present. The visible Link available until line is removed. The 30-day expiry, replacement/revocation checks and immediate closure on completion still apply. Existing valid links show the updated form after refresh. No accounting data, class attendance or assigned mechanic email address is included in the mechanic's projected record.
