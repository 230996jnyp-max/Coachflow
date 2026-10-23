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

## Google Maps location search & directions

- **Where:** the booking flow (client and coach booking modals, reschedule), a client's default gym and the workout location all use `GymSelect` + `PlaceField`. Picking a gym chain (Anytime Fitness, Fitness First, Virgin Active, Jetts, Gold's Gym, ActiveSG) asks "Where is the location / branch?" and lists only that brand's Singapore branches (Places Text Search, filtered by brand). Condo / Park / Others / Private studio search any Singapore gym, condo, street or 6-digit postal code (Places Autocomplete restricted to `sg`, then Place Details).
- **Stored with the booking (encrypted):** name, formatted address, lat/lng and Google place id (`Booking.place`). Other fields keep working for old bookings.
- **Display:** a map-pin pill on booking cards, the dashboard, session details and the booking confirmations opens Google Maps directions (`https://www.google.com/maps/dir/?api=1&destination=<address>&destination_place_id=<id>`); session details and confirmations show a mini map. Calendar events and the coach calendar feed use "name, address" as the location.
- **Setup:** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (browser key restricted to the site's domain, "Places API (New)" enabled). The key only works on the allowed domain, so on localhost (or with no key) the location fields automatically become plain text boxes. The mini map uses free OpenStreetMap tiles until the Maps Embed API is enabled for the key and `NEXT_PUBLIC_MAPS_EMBED=google` is set.

## Smart travel-buffer scheduling

Coaches move between gyms, so availability adapts to *where* neighbouring sessions are (`src/lib/travel.ts`, shared by the browser and the server):

- **Same place = no buffer.** Same Google place id, within 300 m, the same saved gym, or identical typed text: back-to-back is allowed (and flagged "Coach is already at this location - back-to-back slot available!").
- **Different places:** buffer = estimated drive + the coach's parking/walk allowance. The drive is estimated from the straight-line distance (x1.35 for roads, 30 km/h), rounded up to 5 minutes and capped at the coach's maximum. No Google routing API is used. Locations without coordinates (old bookings, typed text) use the coach's default buffer.
- **Settings (Settings > Booking rules):** on/off, default buffer (30), parking/walk (15), longest buffer (90); stored per coach in `coach_settings`.
- **Clients:** a "Training at" picker above the slot grid; `/api/schedule/travel` returns only times, buffer minutes and a same-place flag (never names or locations), and slots that the coach can't reach in time show "Unavailable - Coach travel buffer from another gym location." The server re-checks every booking and reschedule.
- **Coach:** the master schedule shows travel blocks between sessions at different places; the coach can waive the buffer for one booking or reschedule (clients cannot).

## Group classes, shared sessions, waitlist & live group grid

Server: `src/lib/server/groups.ts` (tables `group_sessions`, `group_members`, `group_requests`, `notifications`; routes `/api/groups`, `/api/groups/[id]`, `/api/groups/requests/[id]`, `/api/notifications`). Screens: **Schedule > Classes** (coach), **Book > Group classes** (client), `/classes/[id]`, the notification bell.

- **Coach classes:** title, date/time/length, location (Google Maps picker), 2-30 spots, optional routine, optional weekly repeat (up to 26 weeks). A class blocks 1-on-1 booking for its time and takes part in the travel buffer (the coach can waive it).
- **Booking & waitlist:** a client with a free group credit takes a spot until the class is full; then "Join waitlist" shows "Waitlist #n". When someone leaves (or the coach raises the spots) the first waitlisted client is promoted automatically and notified; anyone without a credit is skipped and told.
- **Privacy:** clients only ever see "2 of 6 spots left", their own place and waitlist number. Names, ids and the roster exist only in the coach's responses.
- **Group credits:** `groupClassCredits` on the client profile (set when adding a client or on the client's page). One credit per client, promised at booking and *used only when the class is completed* (cancelling or leaving never costs one). On completion the coach ticks who attended (absent = no charge); "reopen" gives the credits back.
- **Shared / partner sessions:** a client can open their own 1-on-1 booking to partners (up to 8 people). A newcomer sends a request; the coach and every current attendee must approve (unanswered requests expire after 24 h or 2 h before the start). Requesters never learn who declined; attendees see only the requester's first name. When the booking is completed, partners use a group credit; if the owner cancels, the session passes to the first partner as their own session.
- **Notifications:** bell in the header with a badge for join requests waiting for you, waitlist promotions, cancellations and changes; also a short email when the person has an address.
- **Group workout:** the coach pushes a routine (or an exercise list built on the spot) to every confirmed attendee. Each gets their own copy (`gw_<class>_<client>`), pre-filled from their own previous sets (else the routine's targets); late joiners and promoted waitlisters get theirs automatically.
- **Multi-client live grid:** one card per attendee (progress bar, live PR badges) plus an editor for the selected person. Everything refreshes every 3 seconds while it is open. The coach's edits are saved as field-level changes (`PATCH /api/training/workouts/[id]`) and merged on the server with the client's own saves: a coach edit the client hasn't seen survives their stale save, the client sees "Edited by coach" until they change it, and if both changed the same set at once the client's value is kept and the coach is told.

## Attendance & credit settlement

Server: `src/lib/server/credits.ts` (attendance ledger + credit log), `src/lib/server/attendance.ts` (roll call, finalise, reopen), `POST /api/attendance`, `GET /api/credits/log`. Screens: `src/components/attendance/*`.

- **Roll call** (1-on-1 session details, class page, dashboard "Today's sessions"): tap **Present** or **No-Show** for each person any time (no 30-minute rule); "Mark all present" for groups. The coach can change a mark later at any time, even after finalising, and the credit is corrected automatically.
- **Credit rules:** a credit is *reserved* when booked and only *taken* when the person is marked Present. **No-Show returns it** by default; the per-person toggle **"No-Show - Deduct Credit Anyway"** takes it as a penalty. Each person has one attendance row with a `charged` flag, so switching Present <-> No-Show <-> Present never double-deducts or double-refunds. Cancelling a session or leaving a class returns a credit that was already taken.
- **Final Attendance Confirmation:** "Finalize..." (or "Review" on the pending banner) shows everyone, defaulting to their current mark (or Present), then sets the session to Completed / No-show (class: Completed). "Reopen" returns it to open without touching credits.
- **Partner sessions use group credits:** opening a booking to partners switches the *owner* to a group credit too (needs one free; attendance for owner and partners is one roll call).
- **Pending Attendance:** a banner on the Dashboard and the Schedule tab lists finished sessions/classes not finalised, with one-tap Present / No-Show (1-on-1) or "All present", plus "Review".
- **Attendance rate & Credit log:** per client (coach: client page > Sessions; client: Profile): Attendance % = Present / (Present + No-Show) across 1-on-1 and group, Attended, No-shows, and a log of every credit event (booked/reserved, attended, no-show returned / deducted, corrections, manual adjustments, starting package) with the resulting balance. The log starts when this feature goes live. Older completed / no-show sessions still count in the rate.
- **No-show email:** the client gets an in-app notification and an email saying whether the credit was returned or deducted.
- Old "Mark completed" / "No-show" actions keep working through the same rules. Sessions finished before this feature already took their credit; that state is kept until the coach edits them.

## Guided onboarding tour

`src/components/tour/OnboardingTour.tsx` + `src/lib/tour.ts` (steps and a tiny store). A custom spotlight (no library): the page is dimmed, the target gets a pulsing accent ring, and a card shows "Step n of N", a title, a two-sentence description, **Back / Next** and **Skip Tour** (also Esc / arrow keys). Targets are `data-tour="…"` attributes; the first one that is actually visible is used, so the desktop sidebar and the phone bars both work.

- **When it starts:** automatically on the first login after the person has set their own password (existing accounts see it once too). Finishing or skipping sets `hasCompletedOnboarding: true` on the account (`users.onboarded`, `PATCH /api/me`) and on the device (`coachflow-onboarded:<userId>` in localStorage), so it never interrupts again.
- **Replay:** Settings (coach) / Profile & Settings (client) > Account > **Replay Onboarding Tour**.
- **Coach (6 steps):** schedule & attendance, Book client (Google Maps gyms + travel buffers), clients & credits, workout logger (group workouts / live grid), import from notes (AI), notification bell.
- **Client (5 steps):** home (credits, next session, live group workout), tap-to-book + group classes, workout logging (rest timer, PRs), progress & photo vault, chat with the coach.
- Each step navigates to its page by itself; targets taller than the screen light up just their top part.
