/*
 * One-time (and safe to repeat) Stripe setup:  npm run stripe:setup
 *
 *   - creates the product "CoachFlow Coach Subscription"
 *   - creates the 9 monthly prices in SGD ($15, $18, $21, $24, $27, $30, $33, $36, $40), each with a lookup key
 *     ("coachflow_sgd_15" ...) so the app finds them without storing ids, and GST added on top (tax_behavior: exclusive)
 *   - sets up the customer portal (update card, invoices, cancel at the end of the period)
 *   - optionally registers the webhook:  npm run stripe:setup -- --webhook https://your-site.example.com/api/stripe/webhook
 *   - reports whether Stripe Tax (GST) is ready
 *
 * It reads STRIPE_SECRET_KEY from the environment or .env.local. A live key (sk_live_...) is only used with --live.
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { CURRENCY, lookupKey, sgd, TIER_CENTS } from "../src/lib/billing";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    /* no .env.local: the key may be in the environment */
  }
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.upcoming",
];

async function main() {
  loadEnv();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("\n✖ STRIPE_SECRET_KEY is not set. Put your test key (sk_test_...) in .env.local, then run this again.\n");
    process.exit(1);
  }
  if (!/^(sk|rk)_(test|live)_/.test(key)) {
    console.error("\n✖ That doesn't look like a Stripe secret key (it should start with sk_test_ or sk_live_).\n");
    process.exit(1);
  }
  const live = key.includes("_live_");
  if (live && !flag("--live")) {
    console.error("\n✖ This is a LIVE key. Stripe would create real products. Run again with --live if that is what you want.\n");
    process.exit(1);
  }
  const stripe = new Stripe(key);
  const account = await stripe.accounts.retrieveCurrent();
  console.log(`\nStripe account: ${account.settings?.dashboard?.display_name ?? account.id} (${live ? "LIVE" : "test mode"}), country ${account.country}`);
  if (account.country !== "SG") console.log("  ! This account's country is not Singapore. SGD prices still work, but check your Stripe business settings.");

  // ---- product
  let productId: string | undefined;
  const found = await stripe.prices.list({ lookup_keys: TIER_CENTS.map(lookupKey), limit: 20 });
  productId = found.data.map((p) => (typeof p.product === "string" ? p.product : p.product.id))[0];
  if (!productId) {
    const existing = await stripe.products.search({ query: "metadata['app']:'coachflow' AND active:'true'", limit: 1 });
    productId = existing.data[0]?.id;
  }
  if (!productId) {
    const base: Stripe.ProductCreateParams = { name: "CoachFlow Coach Subscription", description: "Monthly CoachFlow subscription for coaches. The price follows the number of active clients.", metadata: { app: "coachflow" } };
    try {
      productId = (await stripe.products.create({ ...base, tax_code: "txcd_10103001" })).id; // SaaS, business use
    } catch (e) {
      console.log(`  ! Couldn't set the tax code (${e instanceof Error ? e.message : "error"}); creating the product without it.`);
      productId = (await stripe.products.create(base)).id;
    }
    console.log(`✔ Created product ${productId}`);
  } else console.log(`✔ Product already there (${productId})`);

  // ---- prices
  for (const cents of TIER_CENTS) {
    const lk = lookupKey(cents);
    const have = found.data.find((p) => p.lookup_key === lk);
    if (have) {
      if (have.unit_amount !== cents || have.currency !== CURRENCY) console.log(`  ! ${lk} exists with a different amount (${have.unit_amount} ${have.currency}). Prices can't be edited; archive it in Stripe and run this again.`);
      else console.log(`✔ ${sgd(cents)}/mo already there (${have.id})`);
      continue;
    }
    const price = await stripe.prices.create({
      product: productId,
      currency: CURRENCY,
      unit_amount: cents,
      recurring: { interval: "month" },
      lookup_key: lk,
      tax_behavior: "exclusive",
      nickname: `Coach plan ${sgd(cents)}/mo`,
      metadata: { app: "coachflow", tier_cents: String(cents) },
    });
    console.log(`✔ Created ${sgd(cents)}/mo (${price.id})`);
  }

  // ---- customer portal
  const portalFeatures: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: { headline: "Manage your CoachFlow subscription" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "phone", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
    },
    metadata: { app: "coachflow" },
  };
  const configs = await stripe.billingPortal.configurations.list({ limit: 20 });
  const mine = configs.data.find((c) => c.metadata?.app === "coachflow");
  if (mine) {
    await stripe.billingPortal.configurations.update(mine.id, { business_profile: portalFeatures.business_profile, features: portalFeatures.features as Stripe.BillingPortal.ConfigurationUpdateParams["features"] });
    console.log(`✔ Customer portal updated (${mine.id})`);
  } else {
    const c = await stripe.billingPortal.configurations.create(portalFeatures);
    console.log(`✔ Customer portal created (${c.id})`);
  }

  // ---- webhook
  const url = value("--webhook");
  if (url) {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 50 });
    const same = endpoints.data.find((e) => e.url === url);
    if (same) {
      await stripe.webhookEndpoints.update(same.id, { enabled_events: EVENTS });
      console.log(`✔ Webhook already registered (${same.id}); events refreshed. Its signing secret was shown only when it was created: find it in the Stripe dashboard (Developers > Webhooks).`);
    } else {
      const ep = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, description: "CoachFlow subscriptions" });
      console.log(`✔ Webhook registered (${ep.id}).`);
      console.log(`\n  STRIPE_WEBHOOK_SECRET=${ep.secret}\n  ^ add this to Vercel (Environment Variables) and to .env.local. It is shown only once.`);
    }
  } else console.log("• Webhook not registered (pass --webhook https://<your site>/api/stripe/webhook once the site is deployed).");

  // ---- tax (GST)
  try {
    const settings = await stripe.tax.settings.retrieve();
    const regs = await stripe.tax.registrations.list({ status: "active", limit: 20 });
    const sg = regs.data.find((r) => r.country === "SG");
    console.log(`\nStripe Tax: ${settings.status === "active" ? "✔ active" : `✖ ${settings.status}${settings.status_details?.pending?.missing_fields?.length ? ` (missing: ${settings.status_details.pending.missing_fields.join(", ")})` : ""}`}`);
    console.log(`Singapore GST registration: ${sg ? "✔ registered" : "✖ not added yet"}`);
    if (settings.status !== "active" || !sg) console.log("  GST is collected only after both are done. See docs/STRIPE-SETUP.md (step 5). Until then keep STRIPE_TAX off.");
  } catch {
    console.log("\nStripe Tax: couldn't read the settings (it may not be enabled yet). See docs/STRIPE-SETUP.md (step 5).");
  }

  console.log("\nDone. Next: set STRIPE_WEBHOOK_SECRET, then (when ready to charge) BILLING_ENFORCED=1.\n");
}

main().catch((e) => {
  console.error("\n✖ Stripe setup failed:", e instanceof Error ? e.message : e, "\n");
  process.exit(1);
});
