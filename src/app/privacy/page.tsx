import type { Metadata } from "next";
import { LEGAL_CONTACT, LegalPage } from "@/components/signup/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>Account details: name, username, email, phone / WhatsApp number, date of birth, unit preference and your password (stored only as a one-way hash).</li>
          <li>Training information you enter: workouts, routines, body measurements, progress photos, goals, injury or medical notes, food diary entries and chat messages.</li>
          <li>Booking details if you use a coach: sessions, places, attendance and credits.</li>
          <li>Technical data needed to run the service: a sign-in cookie, and network addresses used only for abuse limits (stored in scrambled form).</li>
        </ul>
      </section>
      <section>
        <h2>2. Why we use it</h2>
        <p>To run your account, show you your training and bookings, connect you with your coach, send emails you need (confirming your address, resetting a password, bookings), and keep the service safe.</p>
      </section>
      <section>
        <h2>3. How we protect it</h2>
        <p>
          Personal and health information (workouts, notes, medical notes, food diary, messages, phone numbers) is encrypted before it is stored. Only you, and your coach if you have
          one, can read your training data. Coaches can only see their own clients.
        </p>
      </section>
      <section>
        <h2>4. Who sees it</h2>
        <ul>
          <li>Your coach, if you join one, after they accept you. A coach does not see anything of yours before that, except your name, goal and experience level on the request.</li>
          <li>Service providers who help us run CoachFlow: our hosting and database provider, our email provider, Google Maps (place search) and AI providers.</li>
          <li>AI: when you use an AI feature, the text or photo you submit (for example workout notes or a meal photo) is sent to an AI provider to produce the result. We don&apos;t send your name. Under-18s cannot use AI features.</li>
          <li>We do not sell your information.</li>
        </ul>
      </section>
      <section>
        <h2>5. Under-18s</h2>
        <p>You must be at least 13. People under 18 need a parent or guardian&apos;s agreement, and have no calorie tracking and no AI features.</p>
      </section>
      <section>
        <h2>6. Keeping and deleting</h2>
        <p>We keep your information while your account is open. A coach who deletes a client also deletes that client&apos;s training and food data. You can ask us to delete your account and data at any time.</p>
      </section>
      <section>
        <h2>7. Your rights</h2>
        <p>
          Under Singapore&apos;s Personal Data Protection Act you can ask to see, correct or delete the personal data we hold about you, or withdraw your consent. Email {LEGAL_CONTACT} and
          we will respond within a reasonable time.
        </p>
      </section>
      <section>
        <h2>8. Cookies</h2>
        <p>We use one cookie to keep you signed in, and your browser stores a few settings (like your theme) on your device. We don&apos;t use advertising cookies.</p>
      </section>
      <section>
        <h2>9. Changes and contact</h2>
        <p>We will update this policy when things change and tell you about important changes. Contact: {LEGAL_CONTACT}.</p>
      </section>
    </LegalPage>
  );
}
