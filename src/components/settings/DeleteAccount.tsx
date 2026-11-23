"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { afterAccountDeleted, api } from "@/lib/store";

interface Info {
  username: string;
  canDelete: boolean;
  social: boolean;
  role: "coach" | "client" | "solo" | "owner";
  hasGym: boolean;
}

/**
 * Delete my account: what will go, a typed username, and a password or an emailed link as proof. Used in Settings → Profile and on the
 * public /delete-account page (which the app stores ask for). `token` is the one-hour link from the email.
 */
export function DeleteAccount({ token }: { token?: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null | "signed-out">(null);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<"idle" | "busy" | "sent">("idle");

  useEffect(() => {
    let live = true;
    void (async () => {
      await Promise.resolve();
      const r = await api<Info>("/api/account/delete/info");
      if (!live) return;
      if (r.ok && r.data) setInfo(r.data);
      else setInfo("signed-out");
    })();
    return () => {
      live = false;
    };
  }, []);

  if (info === null) return <p className="text-sm text-muted">Loading…</p>;
  if (info === "signed-out") {
    return (
      <Notice tone="info">
        Sign in first, then come back to this page or open Settings → Profile → Delete account.{" "}
        <a className="font-semibold text-accent" href="/login">
          Sign in
        </a>
      </Notice>
    );
  }
  if (!info.canDelete) return <Notice tone="info">The platform owner account can&apos;t be deleted from here.</Notice>;

  const sendLink = async () => {
    setLink("busy");
    setError(null);
    const r = await api<{ sent: boolean }>("/api/account/delete/request", { body: {} });
    if (!r.ok) {
      setLink("idle");
      return setError(r.error ?? "We couldn't send the link. Please try again.");
    }
    setLink("sent");
  };

  const ready = confirm.trim().length > 0 && (token ? true : password.length > 0);
  const remove = async () => {
    setBusy(true);
    setError(null);
    const r = await api("/api/account/delete", { body: { confirm, ...(token ? { token } : { password }) } });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error ?? "That didn't work. Please try again.");
    }
    await afterAccountDeleted();
    router.replace("/login?deleted=1");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm">
        <div className="font-semibold text-danger">This can&apos;t be undone</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>Your profile, workouts, food diary, measurements, progress photos, messages and everything else stored for you are erased.</li>
          {info.role === "coach" && <li>Your clients are kept, as people with no coach. Your coaching schedule, forms and programs are erased, and your CoachFlow subscription is cancelled.</li>}
          {info.hasGym && <li>Your gym is deleted too. Its other coaches keep their own accounts and become independent.</li>}
          {info.role === "client" && <li>Your coach will no longer see you in their list.</li>}
          <li>If you have a video consult in progress or waiting for its payment to settle, we&apos;ll ask you to wait until it is done.</li>
        </ul>
      </div>

      <Field label={`Type your username (${info.username}) to confirm`}>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="none" autoComplete="off" />
      </Field>

      {token ? (
        <Notice tone="success">You confirmed by email. Type your username above and press the button to finish.</Notice>
      ) : (
        <>
          <Field label="Your password" hint={info.social ? "You sign in with Google, Facebook or Microsoft and may not have a password. In that case use the emailed link below." : undefined}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <div className="text-sm text-muted">
            No password, or forgot it?{" "}
            <button type="button" className="font-semibold text-accent disabled:opacity-60" onClick={() => void sendLink()} disabled={link !== "idle"}>
              {link === "sent" ? "Link sent — check your email" : link === "busy" ? "Sending…" : "Email me a confirmation link"}
            </button>
          </div>
        </>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="danger" disabled={busy || !ready} onClick={() => void remove()}>
        {busy ? "Deleting…" : "Delete my account permanently"}
      </Button>
    </div>
  );
}
