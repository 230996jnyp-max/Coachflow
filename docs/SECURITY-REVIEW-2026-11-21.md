# CoachFlow security review, 21 Nov 2026

What was checked: all 187 API routes, sign-in and sessions, password reset and email links, access control between users, how data is stored and
encrypted, uploads, payments and webhooks, scheduled jobs, the new work on `dev` (AI trainer, social sign-in, straight-in after email
confirm, Admin Users and Add user), dependencies, the repo and its history for secrets, the live site's headers, and the live Vercel settings
(names and types only, never values). The checks were run against a local test copy, never the live site.

## What is already strong
- **Encryption at rest.** Names of clients, health answers, medical notes, workouts, messages, notes, food diary, body data, progress and
  assessment photos, intake forms, payments notes and the AI trainer's data are AES-256-GCM encrypted, with the owning row bound into each
  value so a copied value will not decrypt anywhere else.
- **Passwords** are Argon2id; sessions are signed, `httpOnly`, `SameSite=Lax`, `Secure` in production, expire after 4 hours idle (30 days
  with "stay signed in") and are cut off at once by a password change, reset or disable.
- **One-time links** (confirm email, reset password, the waiting sign-up page) are random, hashed in the database, single-use and expire.
- **Access control.** Every read and write of another person's data goes through an ownership check. A live attack run (another coach, a
  client of the same coach, a client of another coach, a solo user, a gym admin and a signed-out visitor, using the ids of one coach's real
  data against every route) found no way to read or change anyone else's data.
- **Database access** is through a typed query layer with no raw SQL; no unsafe HTML output; outbound calls only go to fixed addresses.
- **Webhooks and scheduled jobs** are authenticated (Stripe signature, `CRON_SECRET` compared in constant time).
- **Dependencies:** 0 known vulnerabilities in what ships (Next.js is on 16.4.6). **Secrets:** none in the repo or its history.

## Fixed in this review (all tested)
1. **Social sign-in could let someone into an account they should not enter.** If an account was started with an address but never confirmed,
   and the real owner later signed in with Google, they were put into that half-made account (whose password somebody else may have chosen).
   Now that account is removed and they sign up fresh. Connecting a provider in Settings now also checks the same person is still signed in.
2. **An unconfirmed sign-up no longer holds someone else's email.** Anyone could type another person's address into the form, locking the real
   owner out, or leaving a link that would drop the owner into an account with a password somebody else chose. Such an account now makes way
   for the real owner's sign-up.
3. **Failed sign-ins are limited per network address** (25 in 10 minutes, counted across all accounts) on top of the per-account lock. Successful
   sign-ins are not counted, so a gym's shared wifi is fine.
4. **Browser security headers** on every page and API answer: cannot be shown inside another site, no content sniffing, referrer and
   permissions policies (camera, microphone and location only for the app itself), plug-ins and base-tag tricks switched off. Signed-in API
   answers are never cached.
5. **Cross-site request checks** added to eight routes that had none (Stripe checkout and portal, Autopilot starter, programme duplicate,
   suggestions, end a programme, workout recap, assessment summary), and every state-changing request that a browser marks as cross-site is
   refused even without an Origin header.
6. **Temporary passwords** are now three words, four digits and a letter (the old comment overstated their strength).
7. **Stripe webhook secret name.** Production has the secret saved as `STRIPE_WEBHOOK_SECRET_KEY` but the code reads `STRIPE_WEBHOOK_SECRET`,
   so the live webhook answers 503 "not configured" and subscription payments are not being recorded. The code now accepts both names.
   *Still to do on your side: rename the variable in Vercel (see below).*

## Needs a decision or action (not changed)
| # | Item | Risk | Suggested step |
|---|------|------|----------------|
| A | **Preview deployments use the production database and secrets** (same Neon store for Preview and Production). Pushing any branch builds a preview that can read and write real data. | High | Give Preview its own Neon branch/database (Vercel Neon integration), or turn Preview off for the `dev` branch. Confirm Vercel "Deployment Protection" is on for previews. |
| B | **Rename `STRIPE_WEBHOOK_SECRET_KEY` to `STRIPE_WEBHOOK_SECRET` in Vercel** (Production) and redeploy. Until then payments are not recorded. | High (money) | Done by you in Vercel; one minute. |
| C | **No full Content-Security-Policy for scripts.** The app's own inline scripts need a per-request nonce first; a wrong rule would break the live site. | Medium | Add a nonce-based CSP in report-only mode first, then enforce. |
| D | **Single encryption key, no rotation.** `DATA_ENCRYPTION_KEY` has no version id, so it cannot be replaced without re-encrypting everything; losing it loses the data. | Medium | Add a key id to stored values and a re-encrypt job; keep an offline copy of the key in a password manager. |
| E | **No two-step sign-in for the owner (and coaches).** The owner account can see everyone's contact details and disable or delete accounts. | Medium | Add authenticator-app codes for the owner first. |
| F | **Readable in the database:** profile pictures, backgrounds and gym logos (`user_media`); push-notification endpoints and keys; account names, emails and usernames (needed to sign in); session type, attendance and credit counts; the shared exercise library. | Low to medium | Encrypt `user_media` and `push_subscriptions` with a tested migration (needs your approval before touching live rows). |
| G | **Progress photos are kept in the person's browser cache for a year** (assessment photos are not). | Low | Switch to no-store like the assessment photos (costs a little data on each view). |
| H | **`APP_URL` is not set in production.** Links in emails use the address the request came from. Vercel only routes your own domains, so this is safe today, but social sign-in needs it anyway. | Low | Set `APP_URL=https://coachflow.pro`. |
| I | **Confirmation link signs you in.** Someone could trick a person into opening *their* confirmation link, signing the victim into the attacker's account. Low chance, and a normal trade-off for "no second sign-in". | Low | Show "Signed in as name@email" on the confirm screen; optional. |
| J | **Logging out does not cancel a stolen cookie** (sessions are stateless); it ends at the idle limit or a password change. | Low | Optional: a server-side session list. |
| K | **Google Maps key is public by design.** It must be restricted to coachflow.pro in Google Cloud. | Low | Check the key's website restriction in Google Cloud Console. |
| L | **Pay-link tokens are stored readable** (they are 144-bit random bearer links). | Low | Store a hash, like the calendar tokens. |
