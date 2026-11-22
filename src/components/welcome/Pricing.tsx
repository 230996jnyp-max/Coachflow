"use client";

import { useState } from "react";
import { TIERS, TRIAL_DAYS, tierFor } from "@/lib/billing";
import { GYM_GRACE_DAYS, GYM_PRICE_CENTS, GYM_SMALL_MAX_COACHES } from "@/lib/gymBilling";

type Who = "train" | "coach" | "gym";

const dollars = (cents: number) => `S$${cents / 100}`;

/** What it costs. The numbers come from the same rules the billing code uses, so this page can't drift from what is charged. */
export function Pricing({ who }: { who: Who }) {
  return (
    <section className="wc-pricing" id="pricing" aria-labelledby="wc-price-h">
      <h2 id="wc-price-h" className="wc-rv">
        Pricing.
      </h2>
      {who === "coach" ? <CoachPrice /> : who === "gym" ? <GymPrice /> : <SoloPrice />}
    </section>
  );
}

function CoachPrice() {
  const [clients, setClients] = useState(12);
  const cents = tierFor(clients);
  const top = TIERS[TIERS.length - 2].upTo;
  return (
    <div className="wc-price-grid">
      <div className="wc-price-main">
        <label htmlFor="wc-price-range">Active clients: <b className="wc-fig">{clients}</b></label>
        <input id="wc-price-range" type="range" min={1} max={60} value={clients} onChange={(e) => setClients(Number(e.target.value))} />
        <div className="wc-price-big" aria-live="polite">
          {dollars(cents)}
          <small> a month</small>
        </div>
        <p className="wc-footnote">
          {dollars(TIERS[0].cents)} up to {TIERS[0].upTo} clients, then a little more for every further {TIERS[1].upTo - TIERS[0].upTo}, and a flat {dollars(TIERS[TIERS.length - 1].cents)} from {top + 1} clients. Prices are in Singapore dollars.
        </p>
      </div>
      <ul className="wc-price-list">
        <li>{TRIAL_DAYS} days free, no card</li>
        <li>Everything included: bookings, programs, Autopilot, payments, nutrition and the AI tools</li>
        <li>No add-ons, and CoachFlow takes no cut of what your clients pay you</li>
        <li>Only clients who are active count</li>
      </ul>
    </div>
  );
}

function GymPrice() {
  const [coaches, setCoaches] = useState(6);
  const small = coaches <= GYM_SMALL_MAX_COACHES;
  return (
    <div className="wc-price-grid">
      <div className="wc-price-main">
        <label htmlFor="wc-price-range">Coaches in your gym: <b className="wc-fig">{coaches}</b></label>
        <input id="wc-price-range" type="range" min={1} max={15} value={coaches} onChange={(e) => setCoaches(Number(e.target.value))} />
        <div className="wc-price-big" aria-live="polite">
          {small ? (
            <>
              {dollars(GYM_PRICE_CENTS)}
              <small> a month, flat</small>
            </>
          ) : (
            <>
              Custom<small> price, agreed with you</small>
            </>
          )}
        </div>
        <p className="wc-footnote">
          One flat price for up to {GYM_SMALL_MAX_COACHES} coaches, however many clients they have. A bigger gym asks us for a custom price. Prices are in Singapore dollars.
        </p>
      </div>
      <ul className="wc-price-list">
        <li>{TRIAL_DAYS} days free to set up</li>
        <li>Covers every coach and your gym&apos;s admins</li>
        <li>Coaches never pay their own subscription</li>
        <li>If a payment fails you get {GYM_GRACE_DAYS} days to fix it, and nothing is deleted</li>
      </ul>
    </div>
  );
}

function SoloPrice() {
  return (
    <div className="wc-price-grid">
      <div className="wc-price-main">
        <div className="wc-price-big">
          {TRIAL_DAYS} days<small> free</small>
        </div>
        <p className="wc-footnote">No card to start. You&apos;ll see the price before anything is charged.</p>
      </div>
      <ul className="wc-price-list">
        <li>Log, track, food, sports and the AI trainer all in one app</li>
        <li>Invite a friend: they start with 60 days free and you get 30 more (up to six friends)</li>
        <li>Got a coach? Add their code and your history comes with you</li>
      </ul>
    </div>
  );
}
