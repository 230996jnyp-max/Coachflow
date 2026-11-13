"use client";

import { Bell, Compass, KeyRound, LifeBuoy, Mail, MapPin, Moon, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CreditHistory } from "@/components/attendance/CreditHistory";
import { GymAffiliation } from "@/components/gym/GymAffiliation";
import { HaveACoachCard } from "@/components/coachlink/CoachLink";
import { HomeAddressField } from "@/components/HomeAddressField";
import { InstallButton } from "@/components/InstallButton";
import { InviteStatus, SyncAllButton } from "@/components/booking/CalendarActions";
import { NumberInput } from "@/components/NumberInput";
import { SpecialtiesCard } from "@/components/sports/Focus";
import { ThemePicker } from "@/components/ThemeSwitcher";
import { UsernameField } from "@/components/UsernameField";
import { Badge, Button, Card, ConfirmDialog, Field, IconButton, Input, Modal, Segmented, Textarea, Toggle } from "@/components/ui";
import { showBrowserNotification } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import type { InviteResult } from "@/lib/notify";
import { requestNicheStep } from "@/lib/nicheGate";
import { SUPPORT_EMAIL } from "@/lib/support";
import { startTour } from "@/lib/tour";
import { deleteGym, saveGym, savePrefs, setUnit, updateSettings } from "@/lib/store";
import type { GymLocation } from "@/lib/types";
import { AccentPicker, BackgroundPicker, CoachBranding, HomeLayoutEditor, PhotoField } from "./Personal";

/** A titled block inside a category page. */
function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-sm font-bold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/* ---------------- Profile ---------------- */
export function ProfileSection() {
  const { user, isTrainer, isPersonal } = useViewer();
  const [nick, setNick] = useState(user?.prefs?.nick ?? "");
  const [bio, setBio] = useState(user?.prefs?.bio ?? "");
  if (!user) return null;
  return (
    <Card className="space-y-5 p-5">
      <PhotoField />
      <Block title="About you" hint="Your coach and the people you train with see these.">
        <Field label="Name you like to be called" hint="Optional. Shown instead of your full name in greetings.">
          <Input value={nick} maxLength={30} onChange={(e) => setNick(e.target.value)} onBlur={() => nick.trim() !== (user.prefs?.nick ?? "") && savePrefs({ nick: nick.trim() })} placeholder={user.name} />
        </Field>
        <Field label="One-line bio" hint={`${bio.length}/140`}>
          <Textarea value={bio} maxLength={140} rows={2} onChange={(e) => setBio(e.target.value)} onBlur={() => bio.trim() !== (user.prefs?.bio ?? "") && savePrefs({ bio: bio.trim() })} placeholder={isTrainer ? "e.g. Strength coach. Helping busy people get strong." : "e.g. Training for my first 10K."} />
        </Field>
      </Block>
      {isTrainer && (
        <Block title="Your coach card" hint="A banner and logo your clients see on their home screen.">
          <CoachBranding />
        </Block>
      )}
      <Block title="Sign-in">
        <UsernameField />
        <Link href="/settings/password">
          <Button variant="secondary">
            <KeyRound size={16} /> Change password
          </Button>
        </Link>
      </Block>
      {!isTrainer && !isPersonal && (
        <Block title="Home address">
          <HomeAddressField clientId={user.id} label="Home address (for sessions at home)" hint="Your coach travels here when a session is at home. Only you and your coach can see it." />
        </Block>
      )}
    </Card>
  );
}

/* ---------------- Notifications ---------------- */
export function NotificationsSection() {
  const { user, isTrainer, db } = useViewer();
  const s = db.settings;
  const [perm, setPerm] = useState<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const [mail, setMail] = useState<{ smtp: boolean; to: string } | null>(null);
  const [test, setTest] = useState<InviteResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/notify")
      .then((r) => r.json())
      .then((d: { smtp: boolean; to: string }) => alive && setMail(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!user) return null;
  const quiet = user.prefs?.quiet ?? null;
  return (
    <Card className="space-y-5 p-5">
      <Block title="App alerts">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bell size={16} /> App alerts for new messages
            </div>
            <div className="text-xs text-muted">
              {perm === "granted"
                ? "On — you’ll get a pop-up when a message arrives while CoachFlow is open or in the background."
                : perm === "denied"
                  ? "Blocked in your browser settings. Allow notifications for this site to turn them on."
                  : perm === "unsupported"
                    ? "This browser doesn’t support notifications."
                    : "Off — enable to get a pop-up when a message arrives."}
            </div>
          </div>
          {perm === "default" && (
            <Button
              variant="outline"
              onClick={async () => {
                const r = await Notification.requestPermission();
                setPerm(r);
                if (r === "granted") showBrowserNotification("Notifications enabled", "You’ll be alerted about new messages.", "enabled");
              }}
            >
              Enable alerts
            </Button>
          )}
        </div>
      </Block>

      <Block title="Quiet hours" hint="No pop-ups or sounds between these times. Messages still arrive and show as unread.">
        <Toggle checked={!!quiet} onChange={(on) => savePrefs({ quiet: on ? { from: "22:00", to: "07:00" } : null })} label="Keep quiet at night" />
        {quiet && (
          <div className="flex flex-wrap items-center gap-3">
            <Moon size={16} className="text-muted" />
            <label className="flex items-center gap-2 text-sm">
              From
              <input type="time" value={quiet.from} onChange={(e) => e.target.value && savePrefs({ quiet: { ...quiet, from: e.target.value } })} className="min-h-11 rounded-lg border border-line bg-field px-3" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              to
              <input type="time" value={quiet.to} onChange={(e) => e.target.value && savePrefs({ quiet: { ...quiet, to: e.target.value } })} className="min-h-11 rounded-lg border border-line bg-field px-3" />
            </label>
          </div>
        )}
      </Block>

      <Block title="Email">
        <div className="text-xs text-muted">
          {mail ? (
            mail.smtp ? (
              <>Delivery is live. Messages from clients and trainer-side calendar invites arrive at <span className="font-semibold text-ink">{mail.to}</span>; messages you send reach the client at their own email.</>
            ) : (
              <>Not configured yet — emails are composed but only previewed. Notifications will go to <span className="font-semibold text-ink">{mail.to}</span> once SMTP is set up (see README → Email setup).</>
            )
          ) : (
            "Checking email delivery…"
          )}
        </div>
        {isTrainer && (
          <>
            <Toggle checked={s.emailChat !== false} onChange={(v) => updateSettings({ emailChat: v })} label="Email when a chat message is sent" />
            <Toggle checked={s.emailInvites !== false} onChange={(v) => updateSettings({ emailInvites: v })} label="Email calendar invites when sessions are booked, moved or cancelled" />
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "test", toName: user.name }) });
                const d = (await res.json()) as { result: InviteResult };
                setTest(d.result);
              } catch {
                setTest({ status: "failed", error: "Network error" });
              }
              setTesting(false);
            }}
          >
            <Mail size={16} /> {testing ? "Sending…" : "Send test email"}
          </Button>
          <SyncAllButton clientId={isTrainer ? undefined : user.id} />
        </div>
        {test && <InviteStatus r={test} />}
      </Block>
    </Card>
  );
}

/* ---------------- Appearance ---------------- */
export function AppearanceSection() {
  const { user } = useViewer();
  if (!user) return null;
  const p = user.prefs ?? {};
  return (
    <Card className="space-y-5 p-5">
      <Block title="Theme" hint="Saved to your account and follows you to your other devices.">
        <ThemePicker />
      </Block>
      <Block title="Accent colour" hint="The colour of buttons and highlights.">
        <AccentPicker />
      </Block>
      <Block title="Background">
        <BackgroundPicker />
      </Block>
      <Block title="Text size">
        <Segmented value={p.textSize ?? "normal"} onChange={(v) => savePrefs({ textSize: v })} options={[{ value: "normal", label: "Normal" }, { value: "large", label: "Large" }, { value: "xl", label: "Extra large" }]} />
      </Block>
      <Block title="Layout">
        <Segmented value={p.density ?? "comfortable"} onChange={(v) => savePrefs({ density: v })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
      </Block>
      <Block title="Home screen" hint="Show, hide and reorder what you see first.">
        <HomeLayoutEditor />
      </Block>
      <Block title="Celebrations">
        <Toggle checked={p.celebrate !== false} onChange={(v) => savePrefs({ celebrate: v })} label="Confetti when you earn a badge" />
      </Block>
      <Block title="Units" hint="Weights and measurements shown across the app.">
        <Segmented value={user.unit} onChange={(v) => setUnit(user.id, v)} options={[{ value: "metric", label: "kg / cm" }, { value: "imperial", label: "lbs / in" }]} />
      </Block>
    </Card>
  );
}

/* ---------------- Coaching (coaches) ---------------- */
export function CoachingSection() {
  const { db } = useViewer();
  const s = db.settings;
  const [gymModal, setGymModal] = useState<Partial<GymLocation> | null>(null);
  const [delGym, setDelGym] = useState<GymLocation | null>(null);
  return (
    <div className="space-y-6">
      <GymAffiliation />
      <Card className="space-y-3 p-5">
        <Block title="Niche and sports" hint="Your exercise library and starter routines are built around these. You choose once and it is saved to your account.">
          <SpecialtiesCard />
          <Button variant="secondary" onClick={requestNicheStep}>
            Change my niche
          </Button>
        </Block>
      </Card>

      <Card className="space-y-3 p-5">
        <Block title="Gym locations">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setGymModal({ name: "", address: "", active: true })}>
              <Plus size={16} /> Add gym
            </Button>
          </div>
          <div className="space-y-2">
            {db.gyms.map((g) => (
              <div key={g.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-field text-accent">
                  <MapPin size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{g.name}</div>
                  <div className="truncate text-xs text-muted">{g.address || "No address"}</div>
                </div>
                <Badge className={g.active ? "border-success/30 bg-success/15 text-success" : undefined}>{g.active ? "Active" : "Hidden"}</Badge>
                <IconButton label={g.active ? "Hide gym" : "Activate gym"} onClick={() => saveGym({ ...g, active: !g.active })}>
                  <span className="text-xs font-bold">{g.active ? "Hide" : "Show"}</span>
                </IconButton>
                <IconButton label="Edit gym" onClick={() => setGymModal(g)}>
                  <Pencil size={16} />
                </IconButton>
                <IconButton label="Delete gym" onClick={() => setDelGym(g)}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))}
            {db.gyms.length === 0 && <p className="text-sm text-muted">No locations yet.</p>}
          </div>
        </Block>
      </Card>

      <Card className="space-y-4 p-5">
        <Block title="Booking rules & branding">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand name">
              <Input value={s.brandName} onChange={(e) => updateSettings({ brandName: e.target.value })} />
            </Field>
            <Field label="Session length (minutes)">
              <NumberInput commitOnBlur label="Session length (minutes)" min={15} max={480} step={15} value={s.sessionMinutes} onChange={(v) => updateSettings({ sessionMinutes: v ?? s.sessionMinutes })} />
            </Field>
            <Field label="Minimum notice (hours)" hint="Clients can’t book or cancel inside this window.">
              <NumberInput commitOnBlur label="Minimum notice (hours)" min={0} max={720} value={s.noticeHours} onChange={(v) => updateSettings({ noticeHours: v ?? s.noticeHours })} />
            </Field>
            <Field label="Default rest timer (seconds)">
              <NumberInput commitOnBlur label="Default rest timer (seconds)" min={15} max={600} step={15} value={s.restSeconds} onChange={(v) => updateSettings({ restSeconds: v ?? s.restSeconds })} />
            </Field>
          </div>
          <Toggle checked={s.autoConfirm} onChange={(v) => updateSettings({ autoConfirm: v })} label="Auto-confirm client bookings (off = require trainer approval)" />
          <Toggle checked={s.allowCustomGym} onChange={(v) => updateSettings({ allowCustomGym: v })} label="Let clients enter a custom gym / condo address" />
          <div className="space-y-3 rounded-xl border border-line p-3">
            <Toggle checked={s.travelEnabled} onChange={(v) => updateSettings({ travelEnabled: v })} label="Travel buffer between sessions at different gyms" />
            <p className="text-xs text-muted">
              Back-to-back sessions at the same place are always allowed. Between two different places, clients can only book times that leave enough travel time, based on the distance plus your parking / walking allowance.
            </p>
            {s.travelEnabled && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Default buffer (min)" hint="Used when a location has no map position.">
                  <NumberInput commitOnBlur label="Default buffer (min)" min={0} max={240} step={5} value={s.travelDefaultMin} onChange={(v) => updateSettings({ travelDefaultMin: v ?? s.travelDefaultMin })} />
                </Field>
                <Field label="Parking / walk (min)" hint="Added to the estimated drive.">
                  <NumberInput commitOnBlur label="Parking / walk (min)" min={0} max={120} step={5} value={s.travelParkingMin} onChange={(v) => updateSettings({ travelParkingMin: v ?? s.travelParkingMin })} />
                </Field>
                <Field label="Longest buffer (min)" hint="No buffer is ever longer than this.">
                  <NumberInput commitOnBlur label="Longest buffer (min)" min={0} max={240} step={5} value={s.travelMaxMin} onChange={(v) => updateSettings({ travelMaxMin: v ?? s.travelMaxMin })} />
                </Field>
              </div>
            )}
          </div>
        </Block>
      </Card>

      <GymModal gym={gymModal} onClose={() => setGymModal(null)} />
      <ConfirmDialog
        open={!!delGym}
        onClose={() => setDelGym(null)}
        danger
        title="Delete gym location?"
        message={`“${delGym?.name}” will be removed. Existing bookings keep their record but clients’ default gym is cleared.`}
        confirmLabel="Delete"
        onConfirm={() => delGym && deleteGym(delGym.id)}
      />
    </div>
  );
}

function GymModal({ gym, onClose }: { gym: Partial<GymLocation> | null; onClose: () => void }) {
  return gym ? <GymForm key={gym.id ?? "new"} gym={gym} onClose={onClose} /> : null;
}

function GymForm({ gym, onClose }: { gym: Partial<GymLocation>; onClose: () => void }) {
  const [name, setName] = useState(gym.name ?? "");
  const [address, setAddress] = useState(gym.address ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={gym.id ? "Edit gym" : "Add gym"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              const err = await saveGym({ id: gym.id, name: name.trim(), address: address.trim(), active: gym.active ?? true });
              if (err) setError(err);
              else onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Gym name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anytime Fitness - Orchard" autoFocus />
        </Field>
        <Field label="Address / notes">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, level, access instructions" />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/* ---------------- My coach (clients and people training solo) ---------------- */
export function MyCoachSection() {
  const { isPersonal } = useViewer();
  return (
    <div className="space-y-6">
      {isPersonal ? <HaveACoachCard /> : <CreditHistory />}
    </div>
  );
}

/* ---------------- Legal & help ---------------- */
export function HelpSection() {
  return (
    <Card className="space-y-5 p-5">
      <Block title="Guided tour" hint="A quick walkthrough of the main screens, any time you want a refresher.">
        <Button variant="secondary" onClick={() => startTour()}>
          <Compass size={16} /> Replay onboarding tour
        </Button>
      </Block>
      <Block title="Install the app" hint="Add CoachFlow to your home screen so it opens full-screen, like a normal app.">
        <InstallButton />
      </Block>
      <Block title="Help">
        <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent">
          <LifeBuoy size={16} /> Email support: {SUPPORT_EMAIL}
        </a>
      </Block>
      <Block title="Legal">
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          <Link href="/terms" className="min-h-11 py-3 text-accent">
            Terms of Use
          </Link>
          <Link href="/privacy" className="min-h-11 py-3 text-accent">
            Privacy Policy
          </Link>
        </div>
      </Block>
    </Card>
  );
}
