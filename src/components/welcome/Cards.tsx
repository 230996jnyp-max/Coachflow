"use client";

import type { ReactNode } from "react";
import { DeloadDemo, ExportDemo, WaitlistDemo } from "./CoachDemos";
import { CodeDemo, ImportDemo, LinkedDemo, TravelDemo } from "./Demos";
import { CoachPerformanceDemo, GymNumbersDemo, GymTeamDemo } from "./GymDemos";
import { AiTrainerLive, AutopilotDemo, BadgesDemo, FloorDemo, InviteDemo, PayNowDemo, ProgramBuilderDemo } from "./NewDemos";
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

/** The hands-on cards for someone training on their own. */
export function PersonalDemoCards() {
  return (
    <>
      <Card title="Beat last week" text="Log your sets. Go heavier than before and it flags a new best.">
        <PersonalLogger />
      </Card>
      <Card title="Your AI personal trainer" text="Answer a short health check and set your goals. It plans your weeks, builds longer programs and adapts to what you log.">
        <AiTrainerLive />
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
      <Card title="Earn your badges" text="Finish workouts, keep your streaks and lift more. Each badge comes with a picture you can share.">
        <BadgesDemo />
      </Card>
      <Card title="Invite a friend" text="They start with 60 days free, and every friend who joins adds 30 days to yours.">
        <InviteDemo />
      </Card>
      <Card title="Add a coach any time" text="Got a coach? Enter their six-digit code and they accept you. Your history comes with you.">
        <CodeDemo />
      </Card>
    </>
  );
}

/** The ten hands-on cards for a coach. */
export function CoachDemoCards() {
  return (
    <>
      <Card title="Both sides, one app" text="Your client logs it, you see it. You leave a note, they see it.">
        <LinkedDemo />
      </Card>
      <Card title="Type a goal. Get a program." text="Tell it the goal, the weeks and any injury. It builds a plan from your exercise library, and you edit anything before a client sees it.">
        <ProgramBuilderDemo />
      </Card>
      <Card title="Messages that send themselves" text="Switch on rules for new clients, missed workouts or low credits. Welcomes go by themselves; nudges wait for your OK.">
        <AutopilotDemo />
      </Card>
      <Card title="Get paid by PayNow" text="Sell a package, the client pays by PayNow, you confirm, and their credits load. No fees on PayNow or cash.">
        <PayNowDemo />
      </Card>
      <Card title="Run the gym floor" text="Train one to four clients at once from one phone or tablet. Weights are pre-filled, and attendance and credits sort themselves out at the end.">
        <FloorDemo />
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

/** The four hands-on cards for a gym owner. */
export function GymDemoCards() {
  return (
    <>
      <Card title="Your team, one roster" text="Coaches join with your gym code and you approve them. You design the roles and what each one can see.">
        <GymTeamDemo />
      </Card>
      <Card title="Know your numbers" text="Classes full, waitlists, cancellations and a busy-times map, by month.">
        <GymNumbersDemo />
      </Card>
      <Card title="See how each coach is doing" text="Sessions, attendance and how many clients stay, as counts. Never a chat, a note or a health form.">
        <CoachPerformanceDemo />
      </Card>
      <Card title="Classes that fill up, fairly" text="Set the spots. Extra people wait in order and move up the moment someone cancels.">
        <WaitlistDemo />
      </Card>
    </>
  );
}
