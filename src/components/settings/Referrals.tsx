"use client";

import { Check, Copy, Gift, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { referralStatusText, showReferralCode, type ReferralStatus } from "@/lib/referral";

interface Summary {
  code: string;
  link: string;
  bonusDays: number;
  maxRewards: number;
  invited: number;
  subscribed: number;
  monthsEarned: number;
  items: { name: string; status: ReferralStatus; at: string }[];
}

const TONE: Record<ReferralStatus, string> = {
  SIGNED_UP: "border-line bg-field text-muted",
  PAID: "border-pr/30 bg-pr/15 text-pr",
  REWARDED: "border-success/30 bg-success/15 text-success",
  CAPPED: "border-line bg-field text-muted",
};
const LABEL: Record<ReferralStatus, string> = { SIGNED_UP: "Signed up", PAID: "Subscribed", REWARDED: "Free month earned", CAPPED: "Limit reached" };

/** Settings, Refer a coach: the coach's code and link, what they earn, and how the coaches they invited are getting on. */
export function ReferralsSection() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/referral")
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Summary & { error?: string };
        if (!alive) return;
        if (r.ok) setData(j);
        else setError(j.error ?? "Couldn't load your referral details.");
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
  const message = `I use CoachFlow to run my coaching (bookings, workouts, client progress). Sign up with my link and you start with ${30 + data.bonusDays} days free: ${data.link}`;

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Gift size={22} className="mt-0.5 shrink-0 text-accent" />
          <div className="text-sm">
            <p className="font-semibold">Invite a coach. You both get a free month.</p>
            <p className="mt-1 text-muted">
              A coach who signs up with your link starts with {30 + data.bonusDays} days free instead of 30. When they become a paying subscriber, you get a month free: it comes off your next bill, or adds 30 days to your free trial. You can earn up to {data.maxRewards} free months.
            </p>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Your referral code</div>
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
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" type="button">
                <Share2 size={14} /> Share on WhatsApp
              </Button>
            </a>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Invited", data.invited],
          ["Subscribed", data.subscribed],
          [`Free months (of ${data.maxRewards})`, data.monthsEarned],
        ].map(([label, n]) => (
          <Card key={String(label)} className="p-3">
            <div className="text-2xl font-bold tabular-nums">{n}</div>
            <div className="text-[11px] text-muted">{label}</div>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        {data.items.length === 0 ? (
          <p className="p-5 text-sm text-muted">Nobody has used your code yet. Share your link with a coach you know.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{it.name}</div>
                  <div className="text-xs text-muted">{referralStatusText(it.status, it.name)}</div>
                </div>
                <Badge className={TONE[it.status]}>{LABEL[it.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
