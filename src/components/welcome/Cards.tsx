"use client";

import type { ReactNode } from "react";
import { DeloadDemo, ExportDemo, WaitlistDemo } from "./CoachDemos";
import { CodeDemo, ImportDemo, LinkedDemo, TravelDemo } from "./Demos";
import { FoodLogDemo, PersonalLogger, SportDemo } from "./PersonalDemos";

function Card({ title, text, badge = "Sample", children }: { title: string; text: string; badge?: string; children: ReactNode }) {
  return (
    <article className="wc-card" data-soon={badge === "Coming soon" || undefined}>
      <div className="wc-card-head">
        <h3>{title}</h3>
        <span className={badge === "Coming soon" ? "wc-soon" : "wc-sample"}>{badge}</span>
      </div>
      <p>{text}</p>
      {children}
    </article>
  );
}

/** A feature that is not built yet: shown honestly, with a picture of the idea and nothing clickable. */
function AiTrainerSoon() {
  return (
    <div className="wc-chat" aria-label="A concept of the AI personal trainer chat">
      <div className="wc-bubble wc-bubble-you">I can train three days a week. Plan my next month.</div>
      <div className="wc-bubble wc-bubble-ai">
        <span className="wc-typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

/** The hands-on cards for someone training on their own. */
export function PersonalDemoCards() {
  return (
    <>
      <Card title="Beat last week" text="Log your sets. Go heavier than before and it flags a new best.">
        <PersonalLogger />
      </Card>
      <Card title="Log food your way" text="Describe a meal, search a food or scan a barcode, and keep calories and protein in view.">
        <FoodLogDemo />
      </Card>
      <Card title="Made for your sport" text="Yoga, boxing, swimming, basketball and more, each with its own drills and the number that matters.">
        <SportDemo />
      </Card>
      <Card title="Paste it. It's logged." text="Bring your notes, a spreadsheet or a photo. Import turns them into a workout.">
        <ImportDemo />
      </Card>
      <Card title="Your AI personal trainer" text="A trainer in your pocket that plans your weeks around your goal and adjusts as you log." badge="Coming soon">
        <AiTrainerSoon />
      </Card>
      <Card title="Add a coach any time" text="Got a coach? Enter their six-digit code and they accept you. Your history comes with you.">
        <CodeDemo />
      </Card>
    </>
  );
}

/** The six hands-on cards for a coach. */
export function CoachDemoCards() {
  return (
    <>
      <Card title="Both sides, one app" text="Your client logs it, you see it. You leave a note, they see it.">
        <LinkedDemo />
      </Card>
      <Card title="Group classes with waitlists" text="Set the spots. Extra clients wait in order and move up the moment someone cancels.">
        <WaitlistDemo />
      </Card>
      <Card title="Deload suggestions" text="When effort stays very high, the logger suggests backing off by a tenth, and you apply it in one tap.">
        <DeloadDemo />
      </Card>
      <Card title="Export workouts" text="Send a routine or a client's history as a PDF, or as plain text that imports straight back in.">
        <ExportDemo />
      </Card>
      <Card title="It knows you travel" text="You move between gyms. Bookings leave room for the journey, so nobody turns up late.">
        <TravelDemo />
      </Card>
      <Card title="Clients join with six digits" text="No invite emails to chase. Share your code and accept who asks.">
        <CodeDemo />
      </Card>
    </>
  );
}
