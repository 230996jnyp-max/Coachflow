import type { Metadata } from "next";
import { LEGAL_CONTACT, LegalPage } from "@/components/signup/LegalPage";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <section>
        <h2>1. What CoachFlow is</h2>
        <p>
          CoachFlow is a tool for personal trainers and coaches to manage clients, bookings and workouts, and for people to log their own training. By creating an account you
          agree to these terms.
        </p>
      </section>
      <section>
        <h2>2. Your account</h2>
        <ul>
          <li>You must be at least 13. If you are under 18, a parent or guardian must agree to you using CoachFlow.</li>
          <li>Give true details, keep your password private, and tell us if you think someone else has used your account.</li>
          <li>You are responsible for what happens under your account. One person per account.</li>
        </ul>
      </section>
      <section>
        <h2>3. Free trial</h2>
        <p>
          New accounts get a 30-day free trial, with no card needed. When paid plans start, we will tell you before your trial ends. Until then we may change what the trial
          includes.
        </p>
      </section>
      <section>
        <h2>4. Your health and training</h2>
        <p>
          CoachFlow is not medical advice. Workout suggestions, deload prompts, calorie and nutrition numbers (including estimates made by AI) are general guidance and can be
          wrong. Speak to a doctor before starting or changing an exercise or diet programme, especially if you are injured, pregnant or have a medical condition. You train at
          your own risk. Coaches are independent and are responsible for the advice and sessions they give.
        </p>
      </section>
      <section>
        <h2>5. Acceptable use</h2>
        <ul>
          <li>No unlawful, abusive or misleading use, and no trying to break into or overload the service or other people&apos;s accounts.</li>
          <li>Don&apos;t use bots, scrape the service, or sign up with someone else&apos;s details or a throwaway email address.</li>
          <li>Coaches must have the right to hold their clients&apos; information and must look after it.</li>
        </ul>
      </section>
      <section>
        <h2>6. Your content</h2>
        <p>
          Your workouts, notes, photos and messages stay yours. You allow us to store and process them to run the service for you, as described in the Privacy Policy. Don&apos;t
          upload anything you don&apos;t have the right to share.
        </p>
      </section>
      <section>
        <h2>7. AI features</h2>
        <p>
          Some features use AI (for example reading workout notes and estimating food). Results can be wrong, so check them. AI features are not available for under-18s.
        </p>
      </section>
      <section>
        <h2>8. Ending your account</h2>
        <p>
          You can stop using CoachFlow at any time and ask us to delete your account. We may suspend or close accounts that break these terms or put others at risk.
        </p>
      </section>
      <section>
        <h2>9. Our responsibility</h2>
        <p>
          We work to keep CoachFlow available and accurate but provide it &quot;as is&quot;. To the extent the law allows, we are not liable for indirect losses, injuries from
          training, lost data or lost income. Nothing here limits rights you have by law.
        </p>
      </section>
      <section>
        <h2>10. Changes and contact</h2>
        <p>
          We may update these terms and will say so in the app or by email when we do. Singapore law applies. Questions or requests: {LEGAL_CONTACT}.
        </p>
      </section>
    </LegalPage>
  );
}
