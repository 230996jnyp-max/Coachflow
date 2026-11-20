"use client";

import { useEffect, useState } from "react";
import { ProviderIcon, providerLabel, socialMessage } from "@/components/signup/SocialButtons";
import { Badge, Notice } from "@/components/ui";
import { api } from "@/lib/store";

interface Data {
  linked: string[];
  available: { id: string; label: string }[];
}

/** Settings → Profile → Sign-in: connect Google, Facebook or Microsoft to this account, so "Continue with…" signs in to it. */
export function ConnectedSignIn() {
  const [data, setData] = useState<Data | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "warn" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      await Promise.resolve();
      if (!live) return;
      const q = new URLSearchParams(window.location.search);
      const linked = q.get("linked");
      if (linked) setNote({ tone: "success", text: `${providerLabel(linked)} is connected. You can now continue with it to sign in.` });
      else if (q.get("social") === "taken") setNote({ tone: "warn", text: "That account is already connected to a different CoachFlow account." });
      else setNote(socialMessage(q.get("social"), q.get("provider")));
      const r = await api<Data>("/api/auth/social/identities");
      if (live && r.ok && r.data) setData(r.data);
    })();
    return () => {
      live = false;
    };
  }, []);

  // Nothing to connect until at least one provider is set up on the server.
  if (!data || data.available.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">Other ways to sign in</div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {data.available.map((p) => {
          const on = data.linked.includes(p.id);
          return (
            <li key={p.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <ProviderIcon id={p.id} />
              <span className="min-w-0 flex-1 text-sm font-semibold">{p.label}</span>
              {on ? (
                <Badge className="border-success/30 bg-success/15 text-success">Connected</Badge>
              ) : (
                <a href={`/api/auth/social/${p.id}/start?mode=link`} className="inline-flex min-h-9 items-center rounded-lg border border-line bg-field px-3 text-sm font-semibold hover:border-accent/50">
                  Connect
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
