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

- **AI keys:** set `GROQ_API_KEY` or, to share the load, `GROQ_API_KEYS="key1,key2,key3"` (server only). Requests take turns across the keys; a key that is rate-limited (429) or rejected (401/403) is set aside for a while and the request goes straight to another one (`src/lib/server/aiKeys.ts`).
- **AI import:** when an AI key is set, *Read my plan* sends the text to Groq (`openai/gpt-oss-120b`) through `/api/import/ai`. Only the notes and a short list of likely library exercise names (shortlisted per line by the local matcher) are sent - never client names. It understands shorthand (`DB Incline 4x8-10 @ 30kg`, `BB RDL`), warm-up / drop / failure sets, supersets, rest and tempo, cardio, dates and multi-day plans, and maps each movement to the library. Photos and scanned PDFs are transcribed first by `qwen/qwen3.8-27b` (`/api/import/extract`). Everything the AI returns is re-validated, and if the AI is unavailable the built-in parser is used automatically. The preview is always shown for review before anything is saved.
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

## Themes (Black, White, Navy Blue)

`<html data-theme="black | white | navy">` switches a set of CSS variables in `src/app/globals.css` (Tailwind's `bg-bg`, `bg-surface`, `bg-field`, `border-line`, `text-ink`, `text-muted`, `bg-accent`, `text-on-accent`, `text-on-success`, ... all read them). Charts and the muscle map use the same variables (`src/components/progress/chartKit.tsx`, `MuscleMap.tsx`), so axes, grids and labels stay readable on every theme.

- **Palettes:** Black is the default (`#090B10` / `#121620` / `#1A202E` / `#262E40`, accent `#3B82F6`); White (`#F8FAFC` / `#FFFFFF` / `#F1F5F9` / `#E2E8F0`, accent `#2563EB`); Navy (`#0A1128` / `#111D3B` / `#182850` / `#23386B`, accent `#38BDF8`). Success / PR / danger colours are deepened on White and lightened on Navy, and text on accent / success / danger fills switches between white and dark navy so it stays high-contrast (e.g. dark text on Navy's light-cyan buttons).
- **Switching:** Settings > Account > Theme (swatch cards), a palette menu in the phone header and at the bottom of the desktop sidebar, and on the login page (device only until sign-in).
- **Persistence:** the choice is saved in `localStorage` (`coachflow_theme`) and on the account (`users.theme`, `themePreference` via `PATCH /api/me`). A tiny inline script in `layout.tsx` applies it before the first paint (no flash); signing in applies the account's saved theme (so it follows you to a new device), or an account with none yet adopts the device's theme. The `theme-color` meta tag (phone browser bar) follows the theme.

## Booking polish: 24-hour time, home sessions, edit session, easier numbers

- **24-hour time picker** (`src/components/TimeSelect.tsx`): one list for the hour (00-23) and one for the minute (00-59), used wherever a time is picked (Book client, Edit session, classes, availability). It replaces the browser's three-column clock. A client's Edit session lists only the coach's open slots for the chosen day.
- **Home sessions:** "Home (client's home)" appears in the location list for the client being booked (the coach travels to them). The home address is saved on the client's profile (`homePlace` / `homeText` in the encrypted profile; Settings for the client, the Profile tab for the coach) and pre-filled next time. Travel buffers use its map position like any other place. It is private: only the client and their coach see it, and a home session can't be opened to partners (also blocked on the server).
- **Edit session** (`PATCH /api/bookings/:id { action: "edit" }`, `EditSessionForm.tsx`): date, time, location, focus and comments in one form, for the coach and the client. A client may always change focus and comments; the date, time and place only outside the notice window, onto an open slot, and without waiving the travel buffer. If the coach approves every booking, a client's move sets the session back to Pending. A time or place change notifies the other person in the app (calendar-invite email as before); comment edits are silent.
- **Postal codes:** a location typed as just `544656` reads "Singapore 544656", and "Use as typed" looks up the real address when map search is available.
- **Number boxes** (`src/components/NumberInput.tsx`): tap selects the whole number, the box can be cleared and retyped (no stuck 0 / "08"), - / + buttons and the arrow keys nudge it, and it is tidied when you leave the box. Used in routine templates, class plans, workout duration, credits and settings (settings save on leaving the box).

## How did it feel? (pain & energy)

When a workout is finished (and on saved workouts) the client rates **Pain** and **Energy** 0-10, optionally picks **where it hurts** and adds notes. Everything is optional. `Workout.feedback` is stored with the encrypted workout (rebuilt field by field in `parseFeedback`, `src/lib/server/training.ts`; the lists and the alert level live in `src/lib/feedback.ts`).

- **Coach alert:** pain 6 or more reported by the client sends the coach a bell notification and an email once per workout (`src/lib/server/feedback.ts`; saving the same workout again never repeats it).
- **Coach views:** a Pain / Energy badge on workout lists, and **Progress > Recovery** on the client page: average pain and energy, number of high-pain sessions, a pain & energy line chart and the areas that hurt most.
- Group classes and partner sessions use the same finish screen.

## Multi-sport library, AI drills & custom tracking

Shared code: `src/lib/sports.ts` (disciplines, sub-categories, joints and tendons / ligaments), `src/lib/tracking.ts` (tracking formats, presets, the calculations and the per-session chart series), `src/data/sportExercises.ts` (the seeded drills). AI: `src/lib/server/ai.ts` (`aiSportExercises`, `aiCustomTracking`) behind `POST /api/ai/sport-exercises` and `POST /api/ai/custom-tracking` (coaches only, same `GROQ_API_KEY` as the AI import; nothing is saved by those endpoints - the coach reviews first).

- **Disciplines:** every exercise has a `discipline` (default "Strength & Gym"), an optional `subCategory` (Skill & Technique, Footwork & Agility, Sport Conditioning, Mobility & Prehab) and optional `joints` / `tissues` tags. The library ships with ~460 exercises: the original gym ones (cardio ones now sit under Endurance & Conditioning) plus ~120 real drills for Mobility & Flexibility (incl. joint / tendon / ligament physio work), Yoga, Boxing & Combat, Swimming, Basketball and Endurance.
- **Joints & connective tissue (merged "part 5"):** tags on exercises (neck, shoulder, elbow, wrist, hip, knee, ankle, spine; rotator cuff, Achilles, patellar tendon, ACL / MCL, plantar fascia, IT band, hamstring tendon, hip flexor, wrist tendons). They are searchable and filterable in the library, shown as badges, and highlighted as rings on the front / back body map (a tendon highlights its joint). Muscles and the muscle charts are unchanged.
- **Add any sport with AI:** Exercise Library > "Add a Sport with AI" (also in Settings > Specialties, and "More drills" per sport). The coach types a sport; the AI designs 10-24 sport-specific drills (technique, footwork, conditioning, mobility), each with a sub-category, muscles, equipment, joints and a tracking format. The coach ticks / renames the ones to keep and saves them and the sport in one tap. They are the coach's own custom exercises (their clients can use them), and drills the coach already has are skipped.
- **Tracking formats:** each drill can log its own columns instead of weight x reps. Seeded presets: hold (per side), reps (per side), rounds + time, boxing rounds (round length, rest, total time), swim (stroke, distance, time, pace per 100 m), shooting (spot, made, attempted, shooting %), timed drills, intervals. Column types: number, time, text, choice and calculated (ratio %, ratio, pace per 100, sum, average, product). A set stores the values in `WorkoutSet.custom`. The progress chart shows any number / time / calculation per session (a ratio is all-made / all-attempted over the session, not an average of percentages) with a best-value badge.
- **Customize Tracking with AI:** on the exercise detail and in the logger's exercise menu (coach only). The coach writes what to track in plain English, the AI builds the columns and the chart metric, the coach previews it (and can change what is charted) and saves it. It is stored per coach per exercise (`exercise_tracking`) and applies to the coach and their clients; "Back to default" removes it.
- **Coach specialties:** Settings > Specialties & sports (and a one-time prompt on the dashboard). The Exercise Library and the routine builder start from "My specialties" with a "Show all sports" option, and Session Focus lists gain the coach's sports next to the usual five.
- **Client focus (assigned by the coach only):** client page > Profile > Training focus (also from the logger header). One focus filters the pickers to it; several show "All assigned focuses" plus a pill for each and, for the coach, "+ Browse all other sports". A client's own library and workout picker stick strictly to the assigned focuses (no way to browse others). No focus assigned = everything.
- Group live grid: sport drills show as read-only lines for the coach (the client enters the values). Exports use the same set text.

## Coach niche, shared drill library & starter routines
- **Niche step:** after every coach sign-in (and after the set-your-password screen on a first login) the app shows "What do you coach?" before the dashboard. It is a step in the sign-in sequence, not a page of its own (`NicheStep.tsx`, flag in `nicheGate.ts`). One tap continues with last time's choice; otherwise pick a primary niche plus any others, or type any other sport under "Something else?". "Change my niche" in Settings reopens it.
- **Niches:** Strength & Gym, Powerlifting, Yoga, Mobility / Rehab / Prehab, Boxing & Combat, Basketball, Swimming, Running / Track / HYROX, and anything typed (AI). A new niche starts with ~60 AI drills the coach reviews and saves.
- **Shared library:** drills for a niche live in `global_exercises` (deduplicated by niche + normalised name; ids `gx_...`; no personal data) and every coach working in that niche, plus their clients, gets them. Strength already ships 300+. Other niches grow to about 300 in the background: the browser asks `POST /api/ai/seed-niche-batch` for one batch of ~25 at a time (a short lock in `niche_seed` stops two coaches building the same niche; it stops at 300 or when new batches add almost nothing). The Exercise Library header shows the progress pill and new drills stream in. A coach can hide a shared drill for themselves ("Hide from my library").
- **Starter routines:** 3-5 per niche, written once by AI from real library drills (`global_templates`) and copied to each coach once per niche (`POST /api/niche/routines`), tagged with the niche. Routine templates shows "My niches" first with an "All niche templates" toggle.
- **Cross-niche freedom:** the Exercise Library and workout picker start from "My niches" with a pill per niche and "+ Show all sports" (loads every shared drill on demand); custom exercises and "Customize tracking with AI" work in every niche.
- AI calls share the rotated Groq keys, and a rate-limited request answers 429 so the background builder simply waits and carries on.

## Speed, usernames & the sign-in hand-over
- **Faster sign-in:** passwords use Argon2id (46 MiB, 2 passes: above OWASP's minimum and stronger than the bcrypt cost-12 it replaces), about 80 ms to check instead of about 430 ms. Older bcrypt hashes keep working and are upgraded the next time that person signs in (`src/lib/server/auth.ts`). If the native module can't load, hashing falls back to bcrypt so sign-in never breaks.
- **Faster loading:** after sign-in the browser asks for the account, workouts (last 60 days first, the rest follows quietly), schedule and classes all at once, and the app appears when they are in, so nothing pops in afterwards. The server runs independent database reads together. A cold server start no longer replays 53 `CREATE TABLE` statements one by one: they are skipped when the stored schema fingerprint matches, otherwise sent as a single batched transaction (`src/lib/server/db.ts`).
- **Smooth hand-over:** the sign-in card fades out and the niche step fades in (no loading flash), then the app fades in.
- **Usernames:** coaches and clients can change their own username in Settings > Account (and optionally on the first-login password screen). A coach can rename a client in the client's Profile tab. Coaches can sign in with their username or their email. Usernames are 3-32 letters, numbers, dots, dashes and underscores (staff may keep an email-style one) and must be unique, also against other coaches' sign-in emails. Changing it doesn't sign anyone out.

## Coach sign-up requests & owner approval
- **Request:** the sign-in screen has "Are you a coach? Sign Up / Request a Coach Account" (`/signup`: full name, email, phone / WhatsApp). Clients are still created by their coach. The request is stored in `coach_signup_requests` (phone encrypted) and nothing else is created. A clear error is shown if the email already has an account or a pending request. Limits: 3 requests per network per hour, 50 waiting at once, and a hidden trap field for bots.
- **Emails (Gmail SMTP via `mail.ts`, display name "Coach Darsh — CoachFlow"):** an alert to the owner (`TRAINER_EMAIL`, else the owner's email) with a link to `/admin`; a "we received your request" email to the applicant; on approval the login details; on decline a not-approved note with `c.darshstrength@gmail.com` for support. All in `src/lib/server/signup.ts`.
- **Owner Admin > Pending Approvals** (badge with the count, also on the Admin menu item): one-tap green tick / red cross, plus a history of earlier requests. Approving creates the coach (their email is the username, random temporary password, must change it on first login) and emails the login. If that email can't be delivered, the account is removed again and the request stays pending (so nobody is approved without their login). A decline stands even if its email fails, and the owner is told.
- Local test mode writes the emails to `.data/outbox.json`; an address starting with `mailfail` simulates an undeliverable email.

## Progression, Coach's Eye, sport PRs, recap card & client imports
- **Suggested today:** in the workout logger, each exercise with history shows a bar and a pill per set (`src/lib/progression.ts`, plain rules, no AI). A barbell lift goes up one plate step when every set was finished at RPE 8.5 or easier; other equipment adds reps first, then a small weight step. Sport drills nudge the one number that matters (+5-10 s on holds, +1 round, +1-2 makes, a faster split). If progress has stalled for two sessions, target reps were missed twice, or effort hit RPE 9.5-10 repeatedly, an amber "Deload Suggested (-10% load / volume)" appears with a one-tap apply. "Why?" shows the rule's reason and, when the AI is free, one short AI sentence (cached, at most 40 a day per person).
- **Coach's Eye:** a collapsible card on a coach's session details and at the top of the logger when logging for a client: focus tags, injury / medical notes, last session, "PRs within reach today" (exercises where today's suggested target would set a record), credits and 90-day attendance (`src/lib/coachEye.ts`). The AI summary line never receives names or injury text.
- **Sport PRs:** records for drills with their own columns (`src/lib/prMetrics.ts`): longest hold and most reps per side, most rounds and longest round, fastest pace for a distance and stroke plus longest distance, shooting accuracy (minimum 10 attempts) and most makes, and the chart metric of any custom format (lower is better for pace-like values). Individual only; no leaderboard.
- **Recap card:** after Finish (and from a completed session or workout) the card shows totals, every new PR, coach notes and remaining credits, with Copy for WhatsApp, Email to client (only when tapped; `POST /api/training/workouts/[id]/recap`), Save picture and Save PDF (`RecapModal.tsx`, `recapImage.ts`).
- **Clients can import:** clients get "Import Workout with AI" on the Workout page: log it as a finished workout, or save it as a routine. Imported routines stay private to the client. AI reads are limited to 5 a day per client (the built-in reader still works after that). Coach notifications: an in-app alert (and a banner on the dashboard) for every workout a client finishes or imports; an email only for imports and workouts with a new PR (at most 6 emails a day per client). A saved routine tells the coach that one was saved, without a link to it.

## Gym-floor mode (coach)

Screen `/floor/<session>` (`src/components/floor/`), rules in `src/lib/floor.ts`, server in `src/lib/server/floor.ts` (`POST /api/floor/end`, `POST /api/floor/walk-in`). A coach runs a live session for one to four people (or a whole class) from one device.

- **Where it starts:** a banner on every coach page when a session starts within the hour (or is under way), a "Run on gym floor" button on the booking and class screens, and the "Session in progress" pill.
- **Lanes:** one per person. On a phone one person at a time with tabs on top (progress, PR count and rest countdown on each tab; swipe to switch); on a laptop or landscape tablet, 2-4 people side by side (four make a 2 x 2 grid). Each lane is the normal logger: tap the tick per set, the weights and reps are already filled in.
- **Pre-fill:** "suggested today" from the progression rules (a small step up after an easy last session, a deload after a stall), else last time's sets, else the routine's own targets. A class starts everyone on the class routine; a 1-on-1 starts on the routine of that client's last finished session; the coach can pick a different routine per person, or start empty. A person who starts later (a walk-in) gets their own Start button.
- **Rest timers:** one per person, with a beep and vibration when it ends (the tab shows "Ready").
- **Notes:** a private note per person ("left knee sore, swapped to box squat") saved on the workout (`coachNote`). The server never sends it to clients (`forClient`) and a client's save can't change or drop it. It shows to the coach at the top of that person's lane next time.
- **Walk-ins:** "Add client" puts another of the coach's clients into the session. A class takes them directly; a 1-on-1 turns into a partner session first. Each person uses one group credit as usual, and a refused walk-in (no credit, home session) changes nothing.
- **End session:** one screen sets Present / No-show per person (Present is pre-selected for anyone who logged sets; no-show can take the credit anyway). One call (`/api/floor/end`) then settles attendance and credits, finalises the booking or class, and sends each client who trained their recap (an in-app notification; an email only for a new PR). It is safe to repeat. Workouts with nothing logged are removed.
- **No signal:** workout changes are queued and retried; a copy of anything unsent is kept on the device (IndexedDB `coachflow-outbox-v1:<user>`) and sent after the next sign-in if the tab was closed, and an "End session" made offline waits and finishes by itself when the connection returns. The header shows All saved / Saving / Offline.
- **Screen:** kept awake (Screen Wake Lock) while a session is open.
- **Workout ids:** class workouts use the id the server gives a pushed class workout (`gw_<class>_<client>`); a 1-on-1 workout is `bw_<booking>_<client>` (id prefixes dropped to stay inside the 80-character limit). One fixed id per person per session, so a second device or a reload never creates a duplicate.
- **Clients logging on their own phones** still works: the screen re-reads workouts every few seconds. Saves are whole-workout, so if the coach and a client change the same set within a few seconds, the later save wins.

## Nutrition (food diary)

Client screen `/nutrition` (`src/components/nutrition/`), coach tab *Nutrition* on each client's page, rules in `src/lib/nutrition.ts`, server in `src/lib/server/nutrition.ts` (`/api/nutrition`, `/api/nutrition/[id]`, `/targets`, `/settings`, `/comments`, `/estimate`, `/search`, `/barcode/[code]`). No setup and no new keys: the AI uses the existing Groq keys, and Open Food Facts is free and keyless.

- **Logging (all feed one review step where every number can be changed):** *Photo* (shrunk to a small JPEG in the browser, read once by the vision AI, never stored), *Describe* (a few words, any cuisine), *Search* (about 120 built-in everyday foods from many cuisines, instant; packaged foods from Open Food Facts' search service; or "estimate with AI"), *Scan* (camera barcode reader, with typing the number as a fallback; a small reader is only downloaded on phones without a built-in detector), *Recent* (one-tap re-add) and *Manual*. Several foods can be collected before saving. Meals: breakfast, lunch, dinner, snacks.
- **Honesty about numbers:** AI estimates and typical dish values are marked *approx.* with a confidence ("good / rough / very rough"). The AI's answer is never trusted as is: every field is re-validated and clamped, calories that disagree with the macros follow the macros (alcohol is left alone), and the person always checks before saving. Open Food Facts values are sanity-checked (impossible numbers are dropped) and cached.
- **Diets and allergies:** a short list on the Nutrition screen (Vegetarian, Vegan, Pescatarian, Halal, No pork, No beef, Gluten-free, Dairy-free; Peanuts, Tree nuts, Milk, Eggs, Wheat, Soy, Fish, Shellfish, Sesame, plus a note). Every food carries tags (what it probably contains) and the app warns when a food conflicts. Allergies are worded as a risk ("may contain"). The coach sees the list. It can miss things, and the screen says so.
- **Targets:** the coach sets calories, protein, carbs and fat for a client (not below 800 kcal); the client can set their own (not below 1,200) or use *Calculate for me* (Mifflin-St Jeor from age, height, weight, activity and goal; never below 1,200; adults only). Targets set by a coach can't be changed by the client. Under 18s (a first-use question, changeable) keep the diary but get no targets, from either side.
- **Coach view:** a week at a glance (days logged, average calories and protein against target, days on target = calories within 10% and protein at least 90%), each day's foods with warnings, and a comment box per day. A comment (and a change of targets) sends the client an in-app notification.
- **Limits and privacy:** 15 AI estimates per person per day (an estimate that fails on our side is given back; typing the numbers always works), 300 packaged-food searches and 200 barcode lookups a day. Entries, targets, diet settings and comments are stored encrypted, bound to their row id (like workouts), only the client and their own coach can read them, and deleting a client removes their diary. A disclaimer (estimates, not medical advice) is shown on the first visit and at the bottom of the screen.
- **Not built yet:** meal plans and recipe books (tracking only), water or step tracking, fibre / sugar / sodium, and signing up without a coach (every account is still created by a coach, so a coachless person can't register yet; the diary itself doesn't need a coach).
