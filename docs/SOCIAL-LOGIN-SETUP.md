# CoachFlow: "Continue with Google / Facebook / Microsoft" setup guide

CoachFlow already has the sign-in code. The three buttons stay **hidden** until you give the server the keys for that provider,
so nothing changes on the live site until you do this. You can switch on one provider at a time (start with Google).

For each provider you do two things: create an "app" in the provider's console, then paste its two values into Vercel
(Project → Settings → Environment Variables → Production) and redeploy. Never paste the secrets anywhere else.

**Redirect URI (the same pattern for every provider):** `https://coachflow.pro/api/auth/social/<provider>/callback`

| Provider  | Redirect URI                                              | Env vars                                |
|-----------|-----------------------------------------------------------|-----------------------------------------|
| Google    | `https://coachflow.pro/api/auth/social/google/callback`   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     |
| Facebook  | `https://coachflow.pro/api/auth/social/facebook/callback` | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`       |
| Microsoft | `https://coachflow.pro/api/auth/social/microsoft/callback`| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |

Also set `APP_URL=https://coachflow.pro` so the server always builds the redirect address from the real site, not from the request.

## Google (recommended first)
1. Go to https://console.cloud.google.com and pick or create a project ("CoachFlow").
2. **APIs & Services → OAuth consent screen**: User type *External*, app name CoachFlow, support email, your logo,
   authorised domain `coachflow.pro`, links to `https://coachflow.pro/privacy` and `/terms`. Scopes: only `openid`, `email`, `profile`.
   Click **Publish app** (move out of "Testing") so anyone can sign in.
3. **Credentials → Create credentials → OAuth client ID → Web application.** Authorised redirect URI: the Google one above.
4. Copy the **Client ID** and **Client secret** into Vercel as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Facebook
1. https://developers.facebook.com → **My Apps → Create app** → use case "Authenticate and request data from users with Facebook Login".
2. **Facebook Login → Settings**: Valid OAuth Redirect URIs = the Facebook one above.
3. **App settings → Basic**: add the privacy policy URL, terms URL and a data-deletion contact, then switch the app to **Live**.
4. Permissions needed: `public_profile` and `email` (both work without app review).
5. Copy **App ID** and **App secret** into Vercel as `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`.

## Microsoft
1. https://entra.microsoft.com → **App registrations → New registration**. Name CoachFlow; supported account types
   **"Accounts in any organizational directory and personal Microsoft accounts"**; Redirect URI platform *Web* = the Microsoft one above.
2. **API permissions**: Microsoft Graph delegated `openid`, `email`, `profile` (the defaults are fine).
3. **Certificates & secrets → New client secret** (pick the longest expiry and put a reminder in your calendar to renew it).
4. Copy the **Application (client) ID** and the secret **Value** into Vercel as `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`.

## How it behaves (so you know what to expect)
- **Log in:** a person who already has an account (Google email that matches, or a provider they connected earlier) is signed straight in.
- **Sign up:** the signup form opens pre-filled with name and email; they still pick a role, answer the role questions, enter their date of birth and accept the terms. No password or email step.
- **Same email already registered:** on the signup screen they are told the account exists and are sent to the normal sign-in; on the login screen they are simply signed in.
- **Trust rule:** only Google's "email verified" flag is trusted. Facebook and Microsoft emails can be changed or spoofed, so they are never used to sign someone into an existing account automatically.
  Someone who signs up with Facebook/Microsoft still gets the usual confirmation email. To use Facebook/Microsoft on an existing account, they connect it in **Settings → Profile → Other ways to sign in** while logged in.
- CoachFlow stores only the provider name, the provider's user id and the email. No provider tokens are kept.
