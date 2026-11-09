import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_UPDATED = "9 November 2026";
export const LEGAL_CONTACT = "c.darshstrength@gmail.com";

/** A readable page for the Terms and the Privacy Policy. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-safe pb-safe mx-auto min-h-dvh w-full max-w-2xl px-4 py-8">
      <Link href="/signup" className="mb-6 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">
        <ArrowLeft size={15} /> Back
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-4 rounded-xl border border-pr/30 bg-pr/10 px-4 py-3 text-sm">
        <strong>Draft.</strong> This is a temporary version written in plain language while CoachFlow is being set up. It has not been reviewed by a lawyer and will be
        updated. Questions: {LEGAL_CONTACT}.
      </div>
      <div className="legal mt-6 space-y-6 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted [&_li]:text-muted [&_ul]:space-y-1">{children}</div>
    </div>
  );
}
