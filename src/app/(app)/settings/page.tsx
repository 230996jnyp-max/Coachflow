"use client";

import { ThemePicker } from "@/components/ThemeSwitcher";
import { CreditHistory } from "@/components/attendance/CreditHistory";
import { Bell, Compass, KeyRound, LogOut, Mail, MapPin, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HomeAddressField } from "@/components/HomeAddressField";
import { InstallButton } from "@/components/InstallButton";
import { InviteStatus, SyncAllButton } from "@/components/booking/CalendarActions";
import { PasswordBanner } from "@/components/PasswordBanner";
import { NumberInput } from "@/components/NumberInput";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SectionTitle,
  Segmented,
  Toggle,
} from "@/components/ui";
import { showBrowserNotification } from "@/lib/chat";
import { useViewer } from "@/lib/hooks";
import type { InviteResult } from "@/lib/notify";
import { startTour } from "@/lib/tour";
import { deleteGym, logout, saveGym, setUnit, updateSettings } from "@/lib/store";
import type { GymLocation } from "@/lib/types";

export default function SettingsPage() {
  const { user, isTrainer, db } = useViewer();
  const router = useRouter();
  const [gymModal, setGymModal] = useState<Partial<GymLocation> | null>(null);
  const [delGym, setDelGym] = useState<GymLocation | null>(null);
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
  const s = db.settings;
  const profile = db.clients.find((c) => c.id === user.id);

  return (
    <div className="space-y-8">
      <PageHeader title={isTrainer ? "Settings" : "Profile & Settings"} />
      <PasswordBanner />
      {!isTrainer && <CreditHistory />}

      <section>
        <SectionTitle>Account</SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} size={56} />
            <div className="min-w-0">
              <div className="truncate text-lg font-bold">{user.name}</div>
              <div className="text-sm text-muted">
                @{user.username} · {isTrainer ? "Trainer" : "Client"}
              </div>
              {profile && (
                <div className="mt-1 text-xs text-muted">
                  Goal: {profile.goal} · {profile.credits} session{profile.credits === 1 ? "" : "s"} remaining
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <div className="text-sm font-semibold">Theme</div>
              <div className="text-xs text-muted">Choose how CoachFlow looks. It is saved to your account and follows you to your other devices.</div>
            </div>
            <ThemePicker />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <div className="text-sm font-semibold">Guided tour</div>
              <div className="text-xs text-muted">A quick walkthrough of the main screens, any time you want a refresher.</div>
            </div>
            <Button variant="secondary" onClick={() => startTour()}>
              <Compass size={16} /> Replay Onboarding Tour
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <div className="text-sm font-semibold">Units</div>
              <div className="text-xs text-muted">Weights and measurements shown across the app.</div>
            </div>
            <Segmented
              value={user.unit}
              onChange={(v) => setUnit(user.id, v)}
              options={[
                { value: "metric", label: "kg / cm" },
                { value: "imperial", label: "lbs / in" },
              ]}
            />
          </div>
          {!isTrainer && (
            <div className="border-t border-line pt-4">
              <HomeAddressField clientId={user.id} label="Home address (for sessions at home)" hint="Your coach travels here when a session is at home. Only you and your coach can see it." />
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Link href="/settings/password">
              <Button variant="secondary">
                <KeyRound size={16} /> Change password
              </Button>
            </Link>
            <InstallButton />
            <Button
              variant="danger"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              <LogOut size={16} /> Log out
            </Button>
          </div>
        </Card>
      </section>


      <section>
        <SectionTitle>Notifications & calendar</SectionTitle>
        <Card className="space-y-4 p-5">
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

          <div className="space-y-1 border-t border-line pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Mail size={16} /> Email notifications
            </div>
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
        </Card>
      </section>

      {user.isOwner && (
        <section>
          <SectionTitle>Administration</SectionTitle>
          <Link href="/admin">
            <Card className="flex items-center justify-between gap-3 border-pr/30 p-4 hover:border-pr/60">
              <div>
                <div className="font-semibold">Administrator page</div>
                <div className="text-sm text-muted">Manage coaches, see client counts and message your coaches.</div>
              </div>
              <ShieldCheck size={22} className="shrink-0 text-pr" />
            </Card>
          </Link>
        </section>
      )}

      {isTrainer && (
        <>
          <section>
            <SectionTitle
              action={
                <Button size="sm" onClick={() => setGymModal({ name: "", address: "", active: true })}>
                  <Plus size={16} /> Add gym
                </Button>
              }
            >
              Gym locations
            </SectionTitle>
            <div className="space-y-2">
              {db.gyms.map((g) => (
                <Card key={g.id} className="flex items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-field text-accent">
                    <MapPin size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{g.name}</div>
                    <div className="truncate text-xs text-muted">{g.address || "No address"}</div>
                  </div>
                  <Badge className={g.active ? "border-success/30 bg-success/15 text-success" : undefined}>
                    {g.active ? "Active" : "Hidden"}
                  </Badge>
                  <IconButton label={g.active ? "Hide gym" : "Activate gym"} onClick={() => saveGym({ ...g, active: !g.active })}>
                    <span className="text-xs font-bold">{g.active ? "Hide" : "Show"}</span>
                  </IconButton>
                  <IconButton label="Edit gym" onClick={() => setGymModal(g)}>
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton label="Delete gym" onClick={() => setDelGym(g)}>
                    <Trash2 size={16} />
                  </IconButton>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle>Booking rules & branding</SectionTitle>
            <Card className="space-y-4 p-5">
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
              <Toggle
                checked={s.autoConfirm}
                onChange={(v) => updateSettings({ autoConfirm: v })}
                label="Auto-confirm client bookings (off = require trainer approval)"
              />
              <Toggle
                checked={s.allowCustomGym}
                onChange={(v) => updateSettings({ allowCustomGym: v })}
                label="Let clients enter a custom gym / condo address"
              />
              <div className="space-y-3 rounded-xl border border-line p-3">
                <Toggle
                  checked={s.travelEnabled}
                  onChange={(v) => updateSettings({ travelEnabled: v })}
                  label="Travel buffer between sessions at different gyms"
                />
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
            </Card>
          </section>

        </>
      )}

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
