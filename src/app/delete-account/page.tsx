import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountPage } from "@/components/settings/DeleteAccountPage";
import { LEGAL_CONTACT } from "@/components/signup/LegalPage";

export const metadata: Metadata = { title: "Delete your account" };

/** Public page that says how to delete a CoachFlow account (Google Play and the App Store ask for it) and lets a signed-in person do it. */
export default function Page() {
  return (
    <div className="pt-safe pb-safe mx-auto min-h-dvh w-full max-w-2xl px-4 py-8">
      <Link href="/login" className="mb-6 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
        ← Back to CoachFlow
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">Delete your CoachFlow account</h1>
      <p className="mt-2 text-sm text-muted">You can delete your account and the information stored in it yourself, any time, in a couple of minutes.</p>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Sign in to CoachFlow (the app or coachflow.pro).</li>
        <li>Open Settings, then Profile, and scroll to Delete account. (Or sign in and stay on this page.)</li>
        <li>Type your username and confirm with your password, or with the link we email you.</li>
      </ol>
      <p className="mt-3 text-sm text-muted">
        Deleting is permanent: your profile, training, food, body measurements, photos and messages are erased straight away, and any CoachFlow subscription is cancelled. Can&apos;t sign in? Email {LEGAL_CONTACT} from the address on your
        account and we will delete it within 30 days.
      </p>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <DeleteAccountPage />
      </div>
    </div>
  );
}
