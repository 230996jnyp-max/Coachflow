# CoachFlow in the Play Store and the App Store

CoachFlow is a web app (coachflow.pro). The store apps are thin wrappers around it, so every web release reaches the apps at once and the stores only need a new build when the wrapper itself changes.

- **Android (Google Play):** a Trusted Web Activity. The built files live **outside the repo** in `C:\Users\leome\coachflow-android` (they hold your signing key). The settings that recreate it are in `mobile/android/twa-manifest.json`.
- **iOS (App Store):** a Capacitor project in `mobile/ios-wrapper` (see the iOS section at the bottom).

## Android

**Package name:** `pro.coachflow.app` (permanent once uploaded). **Upload key SHA-256:** `6E:97:AF:D7:61:6A:53:5A:17:32:72:EA:1A:BB:2F:AC:15:40:CA:B0:57:F9:35:6A:D0:51:8B:5B:E4:53:85:0C`

Files in `C:\Users\leome\coachflow-android`:

| File | What it is |
|---|---|
| `coachflow-1.0.0.aab` | The signed app bundle to upload to Play |
| `android.keystore` + `keystore-password.txt` | The **upload key** and its password. Back both up somewhere private (not the repo, not chat). If lost, Play can reset the upload key, but it takes days |
| `store-assets/screenshots/*.png` | 7 phone screenshots (1081x2402) |
| `store-assets/feature-graphic-1024x500.png` | The Play feature graphic |
| `store_icon.png` | The 512x512 store icon |

### Launching on Google Play (the part only you can do)

1. **Create the developer account** at play.google.com/console (US$25 once). Choose *Personal* or *Organization*. Verify your identity. A **personal** account created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before it can publish; an organization account skips that.
2. **Create the app:** name *CoachFlow*, default language English, *App*, *Free*. Accept the declarations.
3. **Set up the app** (Dashboard → "Set up your app"). Use the answers below.
4. **Upload the bundle:** Testing → Closed testing → Create release → upload `coachflow-1.0.0.aab`. Let Play manage app signing (the default).
5. **Tell me the app signing fingerprint:** Play Console → Test and release → App integrity → *App signing key certificate* → copy the **SHA-256**. It is public, so it is safe to paste in chat. It must be added to `public/.well-known/assetlinks.json` and released to coachflow.pro, otherwise the app shows a browser address bar.
6. Add 12 testers by email (a Google group works), have them join and install, and wait 14 days. Then *Apply for production*, create the production release and submit.

### Store listing text

**App name:** CoachFlow
**Short description (80 max):** Workouts, bookings and progress for personal trainers and their clients.

**Full description:**

> CoachFlow is the all-in-one app for personal trainers and the people they train.
>
> FOR CLIENTS
> • Log workouts fast, with your coach's routines ready to start
> • Track progress, body measurements, photos and a food diary
> • Book sessions and group classes, and see your credits at a glance
> • Message your coach, and get reminders for sessions
> • Train on your own too, with an AI trainer that builds a weekly plan around you
>
> FOR COACHES
> • One calendar for sessions, group classes and availability
> • See who needs you today: missed sessions, low credits, quiet clients
> • Build routines and programs once and assign them to many clients
> • Packages, credits and PayNow or card payments
> • Gym and academy tools for teams
>
> Works even with no signal in the gym: open your plan and log your workout, and it syncs when you are back online.
>
> Your data is yours. You can delete your account and everything in it, any time, from Settings.

**Category:** Health & Fitness. **Tags:** fitness, workout log, personal trainer.
**Contact email:** c.darshstrength@gmail.com. **Website:** https://coachflow.pro. **Privacy policy:** https://coachflow.pro/privacy.
**Account deletion URL (required):** https://coachflow.pro/delete-account

### Answers for the Play Console forms

- **App access:** all or some functionality is restricted. Give the reviewers a demo login (a coach and a client account with test data). Never use a real person's account.
- **Ads:** no ads.
- **Content rating:** Health & Fitness / Utility. No violence, sexual content, gambling or drugs. Users can communicate with each other (coach chat): yes. Users can share their location: no. Digital purchases: yes (subscriptions bought on the website).
- **Target audience:** 13 and over (under 13s are blocked at sign-up). Not designed for children.
- **Health apps declaration:** yes, a health and fitness app (workout logging, nutrition diary). It is not a medical device and gives no diagnosis.
- **Financial features:** none (CoachFlow does not offer loans, banking or investing; coach-to-client payments go through Stripe).
- **Data safety.** Collected, all for *app functionality* and *account management*, all encrypted in transit (HTTPS), sensitive fields also encrypted at rest, and **users can request deletion** (in app and via the URL above):
  - Personal info: name, email address, user IDs, phone number, date of birth
  - Health and fitness: workouts, body measurements, nutrition, injury or medical notes, progress photos (photos are in "Photos and videos")
  - Messages: in-app messages (coach chat)
  - Financial info: payment history (card details are handled by Stripe and never stored by CoachFlow)
  - App activity and diagnostics: sign-in activity, crash-free operation logs
  - **Shared with third parties:** payments (Stripe), email delivery, AI features (health answers and workout notes are sent to an AI provider only when the person uses an AI feature), place search (Google Maps), video consults (Daily). Not sold.

### Rebuilding the Android app

Only needed when something in the wrapper changes (a new icon, theme colour, package settings). Website changes do not need it. From `C:\Users\leome\coachflow-android`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\openjdk\jdk-21.0.8"; $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
# raise appVersionCode in twa-manifest.json AND app\build.gradle first (Play rejects a repeat)
.\gradlew.bat bundleRelease --no-daemon
# then sign app\build\outputs\bundle\release\app-release.aab with jarsigner and the upload key (see this file's history)
```
