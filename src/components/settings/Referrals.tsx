"use client";

import { Check, Copy, Gift, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice, Segmented } from "@/components/ui";
import { REFERRAL_CAPS, referralStatusText, showReferralCode, statusLabel, type ReferralKind, type ReferralStatus } from "@/lib/referral";

interface Summary {
  kind: ReferralKind;
  code: string;
  link: string;
  bonusDays: number;
  soloRewardDays: number;
  cap: number;
  invited: number;
  converted: number;
  rewards: number;
  items: { name: string; status: ReferralStatus; at: string }[];
  coach?: { name: string; rewardCredits: number };
  clientReward?: { credits: number; max: number };
}

const TONE: Record<ReferralStatus, string> = {
  SIGNED_UP: "border-line bg-field text-muted",
  JOINED: "border-accent/30 bg-accent/15 text-accent",
  PAID: "border-pr/30 bg-pr/15 text-pr",
  REWARDED: "border-success/30 bg-success/15 text-success",
  CAPPED: "border-line bg-field text-muted",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What each kind of person is told they can earn, and what their invitation says. */
function copyFor(d: Summary) {
  const trial = 30 + d.bonusDays;
  if (d.kind === "COACH") {
    return {
      headline: "Invite a coach. You both get a free month.",
      body: `A coach who signs up with your link starts with ${trial} days free instead of 30. When they become a paying subscriber, you get a month free: it comes off your next bill, or adds 30 days to your free trial. You can earn up to ${d.cap} free months.`,
      stats: ["Invited", "Subscribed", `Free months (of ${d.cap})`],
      empty: "Nobody has used your code yet. Share your link with a coach you know.",
      share: `I use CoachFlow to run my coaching (bookings, workouts, client progress). Sign up with my link and you start with ${trial} days free: ${d.link}`,
    };
  }
  if (d.kind === "CLIENT") {
    const coach = (d.coach?.name ?? "your coach").replace(/\.$/, ""); // "Ravi K." would end a sentence with two full stops
    const credits = d.coach?.rewardCredits ?? 0;
    return {
      headline: `Invite a friend to train with ${coach}.`,
      body:
        credits > 0
          ? `Your friend signs up with your link and joins ${coach}. When ${coach} accepts them, you get ${credits} free ${plural(credits, "session", "sessions")}. You can earn this up to ${d.cap} times.`
          : `Your friend signs up with your link and asks ${coach} to take them on. ${coach} hasn't switched on referral rewards yet, so you won't get a free session for now. You could ask them.`,
      stats: ["Invited", "Joined", `Free sessions (of ${d.cap})`],
      empty: "Nobody has used your link yet. Send it to a friend who'd like to train with your coach.",
      share: `Come train with me and ${coach} on CoachFlow: book sessions, log workouts and track your progress. Sign up with my link: ${d.link}`,
    };
  }
  return {
    headline: "Invite a friend. You both get a free month.",
    body: `A friend who signs up with your link starts with ${trial} days free instead of 30. When they confirm their account, your free trial grows by ${d.soloRewardDays} days. You can earn this up to ${d.cap} times.`,
    stats: ["Invited", "Joined", `Bonus months (of ${d.cap})`],
    empty: "Nobody has used your link yet. Send it to a friend who trains.",
    share: `I track my training with CoachFlow. Sign up with my link and you start with ${trial} days free: ${d.link}`,
  };
}

/** Settings, Invite & earn: your code and link, what you earn, and how the people you invited are getting on. */
export function ReferralsSection() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/referral")
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Summary & { error?: string };
        if (!alive) return;
        if (r.ok) setData(j);
        else setError(j.error ?? "Couldn't load your invitation details.");
      })
      .catch(() => alive && setError("No connection. Try again."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const copy = async (what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "code" ? showReferralCode(data.code) : data.link);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked: the text is on screen to copy by hand */
    }
  };

  const setReward = async (credits: number) => {
    setSaving(true);
    setSaved(false);
    const r = await fetch("/api/referral", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRewardCredits: credits }) }).catch(() => null);
    if (r?.ok) {
      setData((d) => (d && d.clientReward ? { ...d, clientReward: { ...d.clientReward, credits } } : d));
      setSaved(true);
    } else setError("Couldn't save that. Try again.");
    setSaving(false);
  };

  const c = copyFor(data);
  const noCoach = data.kind === "CLIENT" && !data.coach;

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Gift size={22} className="mt-0.5 shrink-0 text-accent" />
          <div className="text-sm">
            <p className="font-semibold">{c.headline}</p>
            <p className="mt-1 text-muted">{c.body}</p>
          </div>
        </div>

        {noCoach ? (
          <Notice tone="warn">Your coach isn&apos;t available right now, so your invitation can&apos;t bring a friend to them yet.</Notice>
        ) : (
          <>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Your invitation code</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="rounded-xl border border-line bg-field px-4 py-2 font-mono text-xl font-bold tracking-widest">{showReferralCode(data.code)}</code>
                <Button size="sm" variant="secondary" onClick={() => void copy("code")}>
                  {copied === "code" ? <Check size={14} /> : <Copy size={14} />} {copied === "code" ? "Copied" : "Copy code"}
                </Button>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Your invitation link</div>
              <div className="mt-1 break-all rounded-xl border border-line bg-field px-3 py-2 text-sm">{data.link}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copy("link")}>
                  {copied === "link" ? <Check size={14} /> : <Copy size={14} />} {copied === "link" ? "Copied" : "Copy link"}
                </Button>
                <a href={`https://wa.me/?text=${encodeURIComponent(c.share)}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="secondary" type="button">
                    <Share2 size={14} /> Share on WhatsApp
                  </Button>
                </a>
              </div>
            </div>
          </>
        )}
      </Card>

      {data.clientReward && (
        <Card className="space-y-3 p-5">
          <div>
            <div className="text-sm font-semibold">Reward clients who bring a friend</div>
            <p className="mt-1 text-xs text-muted">
              When you accept a friend a client invited, the client earns free sessions: they&apos;re added to their package and you&apos;re told. A client can earn this up to {REFERRAL_CAPS.CLIENT} times. Off by default, so nothing is given away unless you choose.
            </p>
          </div>
          <Segmented
            value={String(data.clientReward.credits)}
            onChange={(v) => void setReward(Number(v))}
            options={Array.from({ length: data.clientReward.max + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? "Off" : `${n} ${plural(n, "session", "sessions")}` }))}
            className="w-full sm:w-auto"
          />
          <p className="text-xs text-muted" aria-live="polite">
            {saving ? "Saving…" : saved ? "Saved." : data.clientReward.credits === 0 ? "Clients aren't rewarded for invitations." : `Each friend who joins earns the client ${data.clientReward.credits} free ${plural(data.clientReward.credits, "session", "sessions")}.`}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3 text-center">
        {[data.invited, data.converted, data.rewards].map((n, i) => (
          <Card key={i} className="p-3">
            <div className="text-2xl font-bold tabular-nums">{n}</div>
            <div className="text-[11px] text-muted">{c.stats[i]}</div>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        {data.items.length === 0 ? (
          <p className="p-5 text-sm text-muted">{c.empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{it.name}</div>
                  <div className="text-xs text-muted">{referralStatusText(it.status, it.name, data.kind)}</div>
                </div>
                <Badge className={TONE[it.status]}>{statusLabel(it.status, data.kind)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
