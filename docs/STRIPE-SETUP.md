# CoachFlow subscriptions: Stripe setup guide

Everything is automated except the few things only the owner can do in Stripe and Vercel. This guide lists them in order.

**Which keys do I need?**

| Value | Looks like | Where it comes from | Where it goes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (test) or `sk_live_...` (live) | Stripe > Developers > API keys > **Secret key** | `.env.local` and Vercel |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Printed by `npm run stripe:setup -- --webhook <url>`, or Stripe > Developers > Webhooks > your endpoint > **Signing secret** | Vercel (and `.env.local` if you test webhooks locally) |
| `CRON_SECRET` | any long random text | You make it up (command below) | Vercel only |
| `BILLING_ENFORCED` | `1` | You decide when | Vercel (leave empty until you are ready to charge) |
| `STRIPE_TAX` | `1` | After GST is set up in Stripe (step 5) | Vercel |
| Publishable key (`pk_...`) | | **Not needed.** Payment happens on Stripe's own page. | nowhere |

Never paste a secret key into chat, email or a screenshot. Put it straight into `.env.local` and Vercel.

---

## 1. Get your TEST secret key

1. Sign in at https://dashboard.stripe.com (create the account at https://dashboard.stripe.com/register if you don't have one; choose **Singapore** as the country).
2. Switch to **test mode** (the "Test mode" toggle at the top right, or your Sandbox).
3. Open https://dashboard.stripe.com/test/apikeys
4. Under **Standard keys**, find **Secret key** (starts with `sk_test_`), click **Reveal test key**, and copy it.
5. Open `coachflow/.env.local` and add a line (no spaces, no quotes):
   `STRIPE_SECRET_KEY=sk_test_...`

## 2. Create the product, the 9 prices and the customer portal (automatic)

In a terminal in the `coachflow` folder:

```
npm run stripe:setup
```

It creates the product **CoachFlow Coach Subscription**, the nine monthly SGD prices ($15, $18, $21, $24, $27, $30, $33, $36, $40; each priced exclusive of GST), and the customer portal (update card, invoices, cancel at the end of the period). You can run it again any time: it only creates what is missing. Check the result at https://dashboard.stripe.com/test/products

## 3. Register the webhook (so the app hears about payments)

After the site is deployed:

```
npm run stripe:setup -- --webhook https://coachflow-eta-eight.vercel.app/api/stripe/webhook
```

It prints `STRIPE_WEBHOOK_SECRET=whsec_...` **once**. Copy it. (If you miss it: Stripe > Developers > Webhooks > the endpoint > **Reveal** under Signing secret: https://dashboard.stripe.com/test/webhooks)

## 4. Add the values to Vercel

1. Open https://vercel.com/230996jnyp-maxs-projects/coachflow/settings/environment-variables
2. Add (Production and Preview): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`.
   Make the cron secret with: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
3. Redeploy (Deployments > the latest > Redeploy) so they take effect.

The daily reminder job (trial ends in 7 days / tomorrow) appears under Settings > Cron Jobs in Vercel and uses `CRON_SECRET`.

## 5. GST (Singapore) with Stripe Tax

Prices are exclusive of GST; Stripe adds it at checkout when `STRIPE_TAX=1`. Before turning that on:

1. **Only if CoachFlow's business is GST-registered with IRAS.** Registration is compulsory once taxable turnover passes S$1 million a year and voluntary below that. If you are not registered you must not charge GST: leave `STRIPE_TAX` empty. Check with IRAS (https://www.iras.gov.sg) or your accountant.
2. Open https://dashboard.stripe.com/test/settings/tax (Tax settings) and set your **head office address** (Singapore) and the default product tax category (the script already tags the product as software as a service, business use).
3. Open https://dashboard.stripe.com/test/tax/registrations > **Add registration** > Singapore > enter your GST registration number.
4. Run `npm run stripe:setup` again: it reports whether Stripe Tax and the Singapore registration are active.
5. Then set `STRIPE_TAX=1` in Vercel and redeploy.

## 6. Test it (test mode)

Sign in as a coach, go to Settings > Subscription & billing > **Subscribe with Stripe**. On Stripe's page use the test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode. You should land back on the dashboard with "You're subscribed". Open **Manage Subscription & Billing** to see the portal.

## 7. Switch the paywall on

Everything above works without charging anyone until you set `BILLING_ENFORCED=1` in Vercel and redeploy. With it on: new coaches get 30 days free; when a trial or subscription ends, that coach and their clients see a "Subscription Required" / "Coaching is paused" screen (nothing is deleted). The owner and every coach the owner added are exempt. Flip it back to empty to switch the paywall off at any time.

## 8. Going live later

1. In Stripe, turn off test mode and get the **live** secret key at https://dashboard.stripe.com/apikeys (you may need to finish activating the account first).
2. In PowerShell run: `$env:STRIPE_SECRET_KEY="sk_live_..."; npm run stripe:setup -- --live --webhook https://<your site>/api/stripe/webhook` (the live key is read from the environment for that one command only; don't save it in a file).
3. Replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel with the live ones, repeat the GST registration in live mode (step 5), and redeploy.
