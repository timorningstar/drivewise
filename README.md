# DriveWise

React/Firebase prototype for the Downtown Ministries DriveWise repair and invoice workflow.

Live DriveWise admin: https://drivewise.web.app
GitHub Pages mirror, after repo setup: https://timorningstar.github.io/drivewise/

## Run it

```bash
npm install
npm run dev
```

Open the local URL Vite prints, usually `http://127.0.0.1:5173/`.

## Included in this prototype

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
- API rewrite: `/api/**` to the shared `api` Cloud Function
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
