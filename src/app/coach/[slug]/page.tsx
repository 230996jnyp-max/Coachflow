import { Award, BadgeCheck, Building2, Dumbbell, MapPin, MessageCircle, Star, Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareProfile } from "@/components/coach/ShareProfile";
import { money } from "@/lib/consults";
import { publicCoach } from "@/lib/server/coachPublic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await publicCoach(slug).catch(() => null);
  if (!c) return { title: "Coach not found · CoachFlow", robots: { index: false } };
  const about = c.data.headline || c.data.about.slice(0, 150) || `${c.name} coaches on CoachFlow.`;
  return {
    title: `${c.name} · Coach on CoachFlow`,
    description: about,
    openGraph: { title: `${c.name} · CoachFlow coach`, description: about, type: "profile" },
  };
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-line"} />
      ))}
    </span>
  );
}

/** A coach's public page: anyone with the link can open it. Only what the coach chose to show; never contact details. */
export default async function CoachPage({ params }: Props) {
  const { slug } = await params;
  const c = await publicCoach(slug);
  if (!c) notFound();
  const { data } = c;
  const initials = c.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const joinHref = c.coachCode ? `/signup?role=client&coach=${c.coachCode}` : "/signup?role=client";

  return (
    <main className="min-h-dvh bg-bg text-ink">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">
              <Dumbbell size={18} />
            </span>
            CoachFlow
          </Link>
          <ShareProfile name={c.name} />
        </div>

        <section className="rounded-3xl border border-line bg-surface p-6 md:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            {c.avatarV ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/public/coach/${encodeURIComponent(c.slug)}/avatar?v=${c.avatarV}`} alt={c.name} className="h-24 w-24 shrink-0 rounded-full border border-line object-cover" />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-accent/15 text-2xl font-bold text-accent">{initials}</div>
            )}
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
              {data.headline && <p className="mt-1 text-base text-muted">{data.headline}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                {c.rating.average !== null && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    <Stars value={c.rating.average} /> {c.rating.average.toFixed(1)} <span className="font-normal text-muted">({c.rating.count} rating{c.rating.count === 1 ? "" : "s"})</span>
                  </span>
                )}
                {data.experienceYears !== null && data.experienceYears > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Award size={15} /> {`${data.experienceYears} year${data.experienceYears === 1 ? "" : "s"} coaching`}
                  </span>
                )}
                {c.gym && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 size={15} /> {c.gym}
                  </span>
                )}
                {data.area && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={15} /> {data.area}
                  </span>
                )}
              </div>
            </div>
          </div>

          {c.niches.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {c.niches.map((n) => (
                <span key={n} className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  {n}
                </span>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={joinHref} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent">
              <MessageCircle size={18} /> Train with {c.name.split(/\s+/)[0]}
            </Link>
          </div>
          {c.coachCode && <p className="mt-2 text-xs text-muted">Signing up with this link connects you to {c.name.split(/\s+/)[0]} (coach code {c.coachCode}).</p>}
        </section>

        {data.about && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">About</h2>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{data.about}</p>
          </section>
        )}

        {data.certifications.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Certifications</h2>
            <ul className="space-y-1.5">
              {data.certifications.map((x) => (
                <li key={x} className="flex items-center gap-2 text-[15px]">
                  <BadgeCheck size={17} className="shrink-0 text-success" /> {x}
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.packages.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Packages</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {c.packages.map((p) => (
                <div key={p.id} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {p.sessions > 0 ? `${p.sessions} session${p.sessions === 1 ? "" : "s"}` : ""}
                    {p.sessions > 0 && p.groupCredits > 0 ? " · " : ""}
                    {p.groupCredits > 0 ? `${p.groupCredits} class${p.groupCredits === 1 ? "" : "es"}` : ""}
                  </div>
                  <div className="mt-2 text-xl font-bold tabular-nums">{money(p.priceCents)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {c.takesConsults && (
          <section className="mt-6 flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
            <Video size={20} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-sm">
              <span className="font-semibold">{c.name.split(/\s+/)[0]} takes consults on CoachFlow.</span> <span className="text-muted">Training on your own? Book a one-hour video consult with a CoachFlow trainer from the AI trainer page.</span>
            </p>
          </section>
        )}

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Reviews</h2>
          {c.reviews.length === 0 ? (
            <p className="text-sm text-muted">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {c.reviews.map((r, i) => (
                <div key={i} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{r.name}</span>
                    <Stars value={r.stars} size={14} />
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{r.text}</p>
                  <div className="mt-1 text-xs text-muted">{new Date(r.at).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })} · after a consult</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="mt-10 text-center text-xs text-muted">
          <Link href="/" className="font-semibold text-accent">
            CoachFlow
          </Link>{" "}
          · training, booking and coaching in one app
        </p>
      </div>
    </main>
  );
}
