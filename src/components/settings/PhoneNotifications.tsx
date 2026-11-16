"use client";

import { Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Notice, Toggle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { disablePush, enablePush, needsInstallForPush, readPushState, type PushState } from "@/lib/pushClient";

interface ServerState {
  configured: boolean;
  publicKey: string | null;
  devices: number;
}

/** Settings, Notifications: "Phone notifications" (Web Push). One switch per device, plus a test button. */
export function PhoneNotifications() {
  const { user } = useViewer();
  const [state, setState] = useState<PushState | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [s, r] = await Promise.all([readPushState(), fetch("/api/push").then((x) => (x.ok ? (x.json() as Promise<ServerState>) : null)).catch(() => null)]);
    setState(s);
    setServer(r);
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(async () => {
      if (alive) await refresh();
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  if (!user) return null;
  const install = typeof window !== "undefined" && needsInstallForPush();
  const on = !!state?.subscribed && state.permission === "granted";

  const toggle = async (next: boolean) => {
    if (!server?.publicKey) return;
    setBusy(true);
    setMessage(null);
    if (next) {
      const err = await enablePush(user.id, server.publicKey);
      setMessage(err ? { tone: "error", text: err } : { tone: "success", text: "On for this device." });
    } else {
      await disablePush(user.id);
      setMessage({ tone: "info", text: "Off for this device." });
    }
    await refresh();
    setBusy(false);
  };

  const sendTest = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { reached?: number; error?: string };
      if (!r.ok) setMessage({ tone: "error", text: j.error ?? "Couldn't send the test." });
      else if (!j.reached) setMessage({ tone: "error", text: "Nothing was sent. Turn it on for this device first." });
      else setMessage({ tone: "success", text: "Sent. It should arrive in a few seconds. If CoachFlow is open in front you won't see a pop-up; switch to another app to try." });
    } catch {
      setMessage({ tone: "error", text: "No connection. Try again." });
    }
    setBusy(false);
  };

  let body: React.ReactNode;
  if (!state || !server) body = <p className="text-xs text-muted">Checking…</p>;
  else if (!server.configured) body = <p className="text-xs text-muted">Phone notifications aren’t switched on for CoachFlow yet. They’ll appear here once they are.</p>;
  else if (install) body = <Notice tone="info">On an iPhone or iPad, add CoachFlow to your Home Screen first (Share, then Add to Home Screen), open it from there, and come back to this page.</Notice>;
  else if (!state.supported) body = <p className="text-xs text-muted">This browser can’t receive phone notifications. Try Chrome, Edge or Firefox, or install CoachFlow to your phone.</p>;
  else if (state.permission === "denied") body = <p className="text-xs text-muted">Blocked in your browser settings. Allow notifications for this site, then come back and switch this on.</p>;
  else
    body = (
      <div className="space-y-3">
        <Toggle checked={on} onChange={(v) => void toggle(v)} label="Notify this device when the app is closed" />
        <p className="text-xs text-muted">Bookings, cancellations, class changes, reminders and new messages. Messages show who wrote, never what they said. Your quiet hours still apply.</p>
        {on && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void sendTest()}>
            <Smartphone size={14} /> Send me a test
          </Button>
        )}
        {server.devices > 0 && <p className="text-xs text-muted">{server.devices === 1 ? "1 device" : `${server.devices} devices`} on for your account.</p>}
      </div>
    );

  return (
    <section className="space-y-3 border-t border-line pt-5" data-tour="phone-notifications">
      <div>
        <h2 className="text-sm font-bold">Phone notifications</h2>
        <p className="mt-0.5 text-xs text-muted">Alerts on your lock screen, even when CoachFlow isn’t open.</p>
      </div>
      {body}
      {message && <Notice tone={message.tone === "error" ? "error" : message.tone === "success" ? "success" : "info"}>{message.text}</Notice>}
    </section>
  );
}
