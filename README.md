# ART BOUTIQUE SRL — Production Manager App

A complete, working React application matching your menu structure:
Production Manager, Cutting Department, Attendance, Finishing Department,
Washing Plan, Delivery, Salary, Leave — each with its sub-screens, forms,
tables, and admin/viewer permissions.

## Run it (VS Code)

1. Open this folder in VS Code.
2. Open a terminal (Terminal → New Terminal) and run:
   ```
   npm install
   npm run dev
   ```
3. Open the URL shown (usually http://localhost:5173).

There's no database required to try it — it runs entirely in the browser
with sample data, so you can see and test everything immediately.

## How permissions work

Top-right of the app there's an **Admin / Viewer** toggle — this simulates
login roles so you can preview both experiences. In a real deployment,
replace this toggle with your actual login system (see "Next steps" below).

- **Admin**: can add, edit, delete every entry, and download every report.
- **Viewer**: can only view. Two exceptions, as you described: on
  **Cutting Production** and **Finishing Production**, a viewer can add
  new entries (their daily input), but still cannot edit or delete them.
- **Salary**: a Viewer never sees amounts — only a "processing" count.
  Only Admin sees the real salary table.

## The one file you'll edit most: `src/config/menuConfig.js`

Every sidebar category, sub-screen, and form field is generated from this
single file. To add a new field to a form, or a whole new sub-screen,
you only need to edit this file — the table, form, and routing update
automatically.

Example — adding a new field to Daily Production:
```js
fields: [
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'line', label: 'Line', type: 'text' },
  { name: 'shift', label: 'Shift', type: 'select', options: ['Day', 'Night'] }, // new
  ...
]
```

## Project structure

```
src/
  config/menuConfig.js     <- edit here to add/change modules & fields
  context/RoleContext.jsx  <- admin/viewer state
  context/DataContext.jsx  <- in-memory data + add/edit/delete (sample data lives here)
  components/Sidebar.jsx   <- auto-generated sidebar
  components/Header.jsx    <- company name/logo bar — change COMPANY_NAME here
  components/DataModule.jsx<- the generic table/form/progress/report renderer
  pages/Dashboard.jsx      <- home screen with summary cards + shortcuts
  pages/Salary.jsx         <- salary page (special permission handling)
```

## Changing the company name / logo

Open `src/components/Header.jsx` and edit `COMPANY_NAME`. To use an image
logo instead of the "AB" initials box, replace the `.brand-logo` div with
an `<img src="/your-logo.png" />` (put the image file in the `public/`
folder first).

## Next steps to make it production-ready

1. **Real login** — replace the Admin/Viewer toggle in `RoleContext.jsx`
   with real authentication (e.g. JWT from a login form), so the role
   comes from the logged-in user, not a button.
2. **Real backend** — right now all data lives in memory and resets on
   page refresh. Connect `DataContext.jsx`'s `getData`/`addEntry`/
   `updateEntry`/`deleteEntry` to real API calls (a Node/Express +
   PostgreSQL backend, matching the schema from your sewing-section
   database, extends naturally to every other module here the same way).
3. **Per-user attendance view** — right now Viewer sees the full
   attendance list. Once real login exists, filter `daily-attendance`
   rows to the logged-in worker's own name if that's what you want.

## Sample data

Sample rows are seeded in `src/context/DataContext.jsx` so every screen
has something to look at right away. Delete or edit the `seed` object
there once you're connecting to real data.

## What's new in this version

- **Dependent dropdowns**: Daily Production / Finishing Production now use
  Employee, Style (pulled live from Order/Model), Department, and a Process
  dropdown that only shows that department's processes (edit the list in
  `PROCESS_MAP` in `menuConfig.js`).
- **Auto Target/Due**: pick a process, type the quantity done, and Target +
  Due are calculated automatically from `PROCESS_TARGETS` in `menuConfig.js`
  — tune those numbers to your real SMV/standard rates.
- **Attendance**: status (Present/Late) and minutes late are now calculated
  automatically from the In Time value — nothing to type by hand.
- **Hourly Production**: a flexible timesheet — add an employee+process row,
  then fill in any of the 10 hour columns in any order (a missed 10 o'clock
  entry can still be filled in at 11).
- **Target vs Actual**: pick an employee from the dropdown to see their
  day-by-day and monthly target vs actual as a chart.
- **Production Line**: shows completed/remaining pieces and Running/Completed
  status per style, computed from Order/Model quantity and Daily Production.
- **Quality Control**: flags a process automatically if its defect rate stays
  above 8% across 2+ entries, so repeat problem processes get noticed.
- **Cutting Report / Finishing Report / Production Report**: target, output,
  and due/extra are now calculated, not typed in.
- **Account menu**: the Admin/Viewer toggle now lives inside a small account
  icon menu instead of a visible "Admin" badge, so a regular user isn't shown
  that an admin mode exists. Wire this to real login before going live.
- **Leave**: both Leave screens now have a comment box.
- Sidebar and dashboard cards use a distinct accent color per department.

### Tuning the "AI target" numbers

There's no live AI model here — the "automatic target per process" is a
lookup table (`PROCESS_TARGETS` in `src/config/menuConfig.js`) so it's
instant and works offline. Update the numbers to match your real time-study
data, or replace `targetForProcess()` in `src/utils/calc.js` with a call to
a real backend endpoint once you have historical data to train on.

## Accounts & Login

- **Sign In** — regular accounts log in with email + password.
- **Create Account** — regular account (view everything, add daily entries
  where allowed). After creating one you'll see a "thank you" screen —
  it does **not** log you in automatically. Go back to Sign In and log in
  with that same email + password.
- **Manager Access** has its own **Create Account** / **Sign In** toggle:
  - *Create Account*: username + email + a password of at least 8
    characters with both letters and numbers. After creating it, you'll
    see a one-time verification code on screen (standing in for a real
    emailed code, since this demo has no email server) — enter it to
    verify, then the account sits **pending admin approval**.
  - *Sign In*: once approved, log in here with that same username +
    password.

**Built-in approver account** (so the approval flow works before any other
manager exists): username `owner`, password `Owner1234`. Sign in via
Manager Access → Sign In with these, and the 🔔 bell icon in the header
will show any pending manager sign-ups with an **Approve** button right
there. Change or remove this seed account in `src/context/AuthContext.jsx`
before real use.

Accounts are stored in the browser's local storage for this demo (see
`src/context/AuthContext.jsx`), so it works without a server. Before
giving this to real users, swap `signup` / `signupManager` / `login` /
`loginManager` for calls to a real backend with hashed passwords and a
real emailed verification code — plain-text passwords in the browser are
fine for trying the app, never for production.

## Notifications

The 🔔 icon in the header lists pending leave requests, and — only when
signed in as the approver account — pending manager sign-ups with an
Approve button. It reads straight from the same data as the Leave and
Salary screens, so there's nothing extra to configure.

## Navigating like a phone app

There's a single **☰** button next to **Dashboard**. Tapping it opens a
drawer listing every department (Sewing Department, Cutting Department,
Attendance, Finishing Department, Washing Plan, Delivery, Leave, Salary).
Tapping a department expands its own sub-screens and collapses whichever
other department was open — only one open at a time, a classic accordion.
Tapping a sub-screen navigates there and closes the drawer, so the page
you picked fills the whole screen. Tap ☰ again any time to jump elsewhere.

## Verification → Sign In → Welcome (updated flow)

- After entering the verification code, you now see **"Your Gmail has
  been verified — please sign in"** immediately, with a button that jumps
  straight into Manager Sign In (username pre-filled).
- **Login no longer waits on approval.** A manager can sign in right
  after verifying their email. While their account is still pending, they
  see the app exactly as a regular user would (a thin banner says so) —
  the moment an approver clicks **Approve** (via the 🔔 notification
  page), that same account gets full manager access automatically, no
  new login required.
- Every successful sign-in shows a brief **"Welcome"** splash for under a
  second before landing on the dashboard.
- The 🔔 bell now opens a **full page** of notifications instead of a
  small dropdown, with a **← Back** button (or tapping the bell again)
  to return to exactly where you were.

**On real email delivery:** a static front-end genuinely cannot send
email by itself — that's a server-side capability, not a UI choice. The
on-screen code is a stand-in for that until this app is connected to a
real backend or an auth provider with built-in email (e.g. Firebase
Authentication, Supabase Auth, or your own server + SendGrid/Resend).
Swapping in real email means replacing `signupManager` /
`verifyManagerEmail` in `src/context/AuthContext.jsx` with calls to
whichever of those you pick — the rest of this flow (the screens, the
pending → approved upgrade, the welcome splash) will keep working
unchanged once real accounts sit behind it.
