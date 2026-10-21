# CoachFlow — PT Client Tracker, Hevy-style Workout Logger & Session Booking (PWA)

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Recharts · date-fns · Lucide · Neon Postgres (Drizzle) with a per-device IndexedDB cache (idb-keyval) · jsPDF.
Installable as a mobile app (PWA) and responsive as a desktop dashboard for the trainer.

## Deployed

Production: https://coachflow-eta-eight.vercel.app (Vercel project `coachflow`, team `230996jnyp-maxs-projects`).
Accounts and chat are stored in Neon Postgres (via the Vercel Marketplace integration); email goes out through Gmail SMTP using the project's `SMTP_USER` / `SMTP_PASS` environment variables. Redeploy with `npx vercel deploy --prod`.
Deployment Protection is on by default, so only people logged in to Vercel can open the URL until it is turned off (Project → Settings → Deployment Protection).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start   # production build (service worker + offline shell active)
```

See `.env.example` for the required environment variables (Neon database URL, auth secret, encryption key, SMTP). `LOCAL_PGLITE=1 npm run dev` runs everything on an in-memory database for testing.

## Accounts, roles and security

There are no demo accounts. Three roles, all stored in **Neon Postgres**:

| Role | What they can do |
| ---- | ---------------- |
| **Owner** (Coach Darsh) | Everything a coach can, plus the `/admin` page: add/deactivate coaches, see coach names, emails, status and **client counts only**, message or announce to coaches. |
| **Coach** (e.g. Coach Akash) | Create and manage *their own* clients, log workouts, schedule, chat with their clients and with the owner. |
| **Client** | Sees only their own data and chats with their coach. |

- Passwords are hashed with bcrypt (cost 12); sessions are signed, httpOnly cookies (7 days, revoked on password change/deactivation); 5 failed logins lock an account for 15 minutes.
- Client personal data (name, phone, email, goal, medical notes, package credits) and every chat message are encrypted at rest with AES-256-GCM (`DATA_ENCRYPTION_KEY`), bound to their row so ciphertext can't be moved between records. The database connection enforces `sslmode=require`.
- Authorization is enforced on the server: a coach's clients are visible only to that coach and the client themselves; the owner page runs `count(*)` only. **This is encryption at rest plus server-side access control, not end-to-end encryption** — the server holds the key.
- New coaches/clients get a temporary password and must choose their own at first login.

Environment variables: `DATABASE_URL` (Neon), `DATA_ENCRYPTION_KEY` (32 bytes, base64 — **keep a backup, losing it makes encrypted data unreadable**), `AUTH_SECRET`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_TZ`.

## What's inside

- **Auth & onboarding** – no public sign-up. The trainer creates clients (name, username, temp password, credits, goal, gym, medical notes), gets a **Copy Login Credentials** card, can edit / reset password / archive / delete. Clients see a first-login banner and change their password at `/settings/password`.
- **Exercise library** – 330+ pre-seeded exercises across every muscle group and equipment type, instant fuzzy search (aliases like "RDL", "OHP"), muscle + equipment filters, and custom exercises. Measurement types: weight×reps, bodyweight reps, weighted bodyweight, cardio (time/distance/level/kcal), duration only.
- **Exercise detail** – tap any exercise (library or inside a workout) for a Hevy-style screen: start/end photos and step-by-step instructions for ~260 exercises from the public-domain [free-exercise-db](https://github.com/yuhonas/free-exercise-db), a generated front/back muscle diagram for every exercise, and that client's progress chart (heaviest weight / 1RM / best set volume) with a PR medal, plus history. Lookup file: `public/exercise-media.json`.
- **Workout logger** (trainer *or* client, `/workout`) – live timer, set types (tap `SET` to cycle W / normal / D / F), **Previous** lookup with tap-to-fill, optional RPE, rest timer (±15s, skip, beep/vibrate), real-time **PR badges** (heaviest weight, Epley est. 1RM, best set volume, plus reps/time/distance PRs), back-dated logging, routine templates (Push / Pull / Leg / Full Body pre-loaded; save any workout as a template).
- **Progress hub** – strength charts (est. 1RM, weight & best set, volume per session; 1M–All), weekly volume & frequency, streak, muscle-group split (7/30 days), cardio tracker, body weight & measurements with trend charts, and a progress-photo vault with side-by-side / slider **before-after comparison**.
- **Booking** – (stored in Neon, so a client booking on their phone sees their coach's live availability)  trainer defines weekly windows, one-off slots and blocked time, manages gym locations, books clients directly, approves/declines (if auto-confirm is off), reschedules, cancels, marks **Completed** (deducts 1 credit) or no-show. Clients tap an open slot, choose a **gym** (or custom address), focus and notes. Other clients' bookings show only as *Unavailable / Booked*.

## Calendar sync & notifications

- **Add to calendar** – every session has *Google*, *Outlook*, *Apple / .ics* buttons (the .ics includes reminders 24 h and 1 h before). **Sync calendar** on Book / Schedule / Settings downloads all upcoming sessions as one `.ics` file.
- **Emailed invites** – when a session is booked, moved or cancelled, an invite email with a calendar attachment goes to the other party (client books → trainer, trainer books → client). Gmail/Outlook show it as an event card and update or remove the event on changes. *Email me invite* sends a copy to yourself.
- **Chat** (`/messages`) – trainer ↔ client messaging. Messages are stored on the server (`.data/chat.json`, via `/api/chat`) and polled every few seconds, so two devices pointed at the same server stay in sync. New messages raise an unread badge, an in-app toast, a browser notification (enable under Settings → Notifications) and an **email**.
- **Email routing** – a client's message goes to their coach's email; a coach's message goes to the client's email on file; owner ↔ coach messages go to each other. Recipients are looked up on the server, never supplied by the browser.

### Email setup (required for real delivery)

Without SMTP credentials the server composes each email but does **not** send it (the chat shows “Email preview only”, and the message is logged to `.data/outbox.json`).

1. Google Account → Security → turn on 2-Step Verification, then create an **App Password** (https://myaccount.google.com/apppasswords).
2. Copy `.env.example` to `.env.local`, set `SMTP_USER` and `SMTP_PASS`, and restart `npm run dev`.
3. Settings → Notifications → **Send test email**.

`.env.local` is git-ignored — never commit the password.


### Calendar sync

- **Live subscription (coach)** – Schedule → **Sync to My Calendar** gives a private `webcal://` link (also an *Add to Google Calendar* button). Subscribed calendars receive every new, moved and cancelled session. The feed is `/api/calendar/<secret-token>.ics` (RFC 5545), shows client names, focus and location but never notes, and *Generate a new link* revokes the old one. Calendar apps poll on their own schedule (Apple minutes–hours, Outlook hours, Google about once or twice a day), so it is not instant; the emailed invites are the instant path.
- **One-tap add** – the booking confirmation, upcoming-session cards and session details offer *Google Calendar*, *Outlook* and *Apple / .ics*.
- **Where the data lives** – gyms, availability, booking rules and bookings are in Neon (booking notes and free-text locations are encrypted). The server re-checks every booking: notice window, open slot (using the coach's UTC offset), package credits and clashes; completing a session deducts a credit there.

### Local end-to-end testing

`LOCAL_PGLITE=1 npm run dev` runs the app against an in-memory Postgres (PGlite) and never sends real email, so flows can be exercised without touching production.

## Booking & credit rules (configurable in Settings)

- 60-minute sessions, **12 h notice** to book or cancel (clients only; the trainer is exempt), auto-confirmed.
- Booking *reserves* a credit (`available = credits − upcoming bookings`); the credit is *deducted* when the trainer marks the session Completed / No-show, and restored if that is undone.

## Architecture

```
src/lib/types.ts       domain models (User, ClientProfile, Exercise, Workout, WorkoutSet, BodyMetricLog,
                       ProgressPhoto, GymLocation, AvailabilitySlot, Booking, …)
src/lib/store.ts       the only data-access layer (state + IndexedDB persistence + all mutations)
src/lib/seed.ts        deterministic demo data (3 clients, 10–12 weeks of history)
src/lib/stats.ts       PR detection, previous-set lookup, volume/streak/muscle-split analytics
src/lib/scheduling.ts  slot generation, credit & cancellation rules
src/data/exercises.ts  exercise library
```

Components never touch IndexedDB directly: to move to Supabase/PostgreSQL, re-implement `initStore`, `persist` and the exported action functions in `store.ts` (the types map 1:1 to tables), and replace the plaintext demo passwords with Supabase Auth.

## Where data lives

- **Neon Postgres (shared across devices):** accounts, client profiles, chat, bookings, availability, gyms, booking rules, **workouts, routine templates and custom exercises**. Workouts, routines, profiles, messages and booking notes are AES-256-GCM encrypted at rest.
- **Per device (IndexedDB, separately for each signed-in user):** body-metric logs, progress photos and personal settings (brand name, rest timer, email toggles). These move to the database in a later step.
- Workouts and routines are edited instantly on the device and saved by a write-behind queue (`src/lib/syncQueue.ts`); a 45-second poll (and a refresh when the tab regains focus) brings in changes from other devices. The first time a user signs in after the move, anything their browser still had locally is uploaded once (`/api/training/migrate`), and the built-in starter routines are created once per coach.

## Workout import & export (coaches)

- **Import** (Workout page → *Import from Notepad / text*): paste text, or upload / drop a file — PDF, Word (.docx), Excel (.xlsx), CSV, text, Markdown, RTF or HTML (read on the server by `/api/import/extract`; tables are rebuilt as `Exercise - 4 x 8 @ 80kg` lines by `src/lib/tableText.ts`; CoachFlow's own PDF exports re-import cleanly). Photos, screenshots and scanned PDFs are transcribed by the vision AI. Understands lines like `Barbell Bench Press - 4 x 8 @ 80kg`, `Incline Dumbbell Press: 3 sets x 10-12 reps (24kg)`, `Lat Pulldown 3x12`, `Squat 60x10, 70x8, 80x6`, `Treadmill Incline Walk - 20 mins`, `Plank 3 x 45s`, with `# Heading` separated workouts, bullets/numbering, `Note:` lines and dates (`12 Oct 2026`, `12/10/2026`, `2026-10-12`). Exercises are fuzzy-matched to the library (`src/lib/exerciseMatch.ts`); unmatched ones must be mapped or created as custom before saving. Save to routine templates or log as completed workouts for a client, on the date written in the text (default date otherwise). Parser: `src/lib/workoutText.ts`.
- **Export** (Workout page → *Export workouts*, or the download icon on a routine): one routine/workout, a client's history (optional date range) or all routines you created, as a formatted PDF (CoachFlow header + logo, jsPDF) or plain text (copy / `.txt`, re-importable).

## Notes

- PWA install and the service worker require HTTPS (or `localhost`). Deploy (e.g. Vercel) to install on a phone.

## AI workout reading & session timeout

- **AI import:** when `GROQ_API_KEY` is set (server only), *Read my plan* sends the text to Groq (`openai/gpt-oss-120b`) through `/api/import/ai`. Only the notes and a short list of likely library exercise names (shortlisted per line by the local matcher) are sent - never client names. It understands shorthand (`DB Incline 4x8-10 @ 30kg`, `BB RDL`), warm-up / drop / failure sets, supersets, rest and tempo, cardio, dates and multi-day plans, and maps each movement to the library. Photos and scanned PDFs are transcribed first by `qwen/qwen3.8-27b` (`/api/import/extract`). Everything the AI returns is re-validated, and if the AI is unavailable the built-in parser is used automatically. The preview is always shown for review before anything is saved.
- **4-hour inactivity sign-out (all accounts):** the browser timestamps real activity (mouse, keys, touch, scroll, navigation) in `localStorage` and signs out after 4 hours (`src/components/IdleGuard.tsx`, `src/lib/idle.ts`). The server enforces the same limit: the session cookie carries a last-activity time that only `/api/auth/activity` (sent when the user is genuinely active) refreshes, so background polling never keeps a session alive. After a timeout the login page shows a notice, fills in the last username on that device and leaves the password empty (passwords are never stored).
