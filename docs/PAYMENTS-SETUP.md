# Coach-to-client payments: setup

Clients pay their coach for packages inside CoachFlow. The money goes **straight to the coach**: either through the coach's own Stripe
account (Stripe Connect, Standard accounts, "direct charges") or by PayNow / cash that the coach confirms. CoachFlow charges **0%**
(the Stripe "application fee" is never set), and never holds the money.

This branch is `feature/payments`. It is not part of a Sunday release until you decide to merge it.

## What you need once (as the platform owner)

1. **A Stripe account** with **Connect enabled**. In the Stripe dashboard open **Connect** and press **Get started** (choose "Platform or
   marketplace"). Do this in the sandbox / test mode first. You do not need to build onboarding screens: Stripe hosts them.
   - Check: `POST /v1/accounts` with `type=standard` must work in test mode (it returns "You can only create new accounts if you've
     signed up for Connect" until Connect is on).
   - Going live needs your Stripe account to be fully activated, and Stripe may review the Connect platform profile.
2. **Environment variables** (Vercel and `.env.local`; see `.env.example`):
   - `STRIPE_SECRET_KEY` - `sk_test_...` while testing, `sk_live_...` when live.
   - `STRIPE_CONNECT_WEBHOOK_SECRET` - the signing secret (`whsec_...`) of the webhook below.
3. **A webhook** (Developers > Webhooks > Add endpoint):
   - URL: `https://<your domain>/api/stripe/connect-webhook`
   - Turn on **Listen to events on Connected accounts** (a "Connect" webhook; this is what makes it different from the subscription webhook).
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `account.updated`.
   - Copy its signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`.

## What each coach does

Settings > Payments > **Connect Stripe**. Stripe asks for their identity and bank account (a few minutes), then the coach is ready.
For PayNow through Stripe they turn PayNow on in their own Stripe dashboard (Settings > Payment methods). Coaches who do not want
Stripe can add a PayNow number (no fees at all; they confirm each payment) and record cash or bank transfers.

## Who pays what

- CoachFlow: nothing (application fee 0).
- The coach: Stripe's own processing fee, billed by Stripe to the coach's account (Singapore: cards about 3.4% + S$0.50, PayNow
  about 1.3%). Refunds, disputes and payouts are handled in the coach's own Stripe dashboard.
- Paying by PayNow directly, or in cash, costs nobody anything.

## How a payment turns into credits

1. A client buys on `/pay` (or opens a coach's payment link `/pay/<code>`, which needs no account, so a parent or guardian can pay).
2. Stripe Checkout is created **on the coach's account** for the package price taken from the server (never from the browser).
3. Stripe calls the webhook. The signature is checked, and the event is only used if the order, the amount, the currency and the
   coach's Stripe account all match what the server stored. Credits are added once (a guarded status change plus a table of event ids),
   however many times Stripe repeats itself.
4. A refund (in the app, or made in the Stripe dashboard) takes the credits back, never more than the client has left.

## Local testing without Stripe

Start the server with `PAYMENTS_FAKE_STRIPE=host:port` (honoured only when `LOCAL_PGLITE=1`) and point it at a stand-in Stripe; the launch
configuration `coachflow-payments-test` does this. No real money and no network are involved.

## Not built yet

Partial refunds, expiring packages, recurring packages (subscriptions), GST tax invoices, a PayNow QR image (the number and a
reference are shown instead), and merging this branch with the coach-subscription billing on `feature/stripe-billing`.
