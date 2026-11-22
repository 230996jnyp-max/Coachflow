"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarPlus,
  FileUp,
  KeyRound,
  Minus,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { BookingList } from "@/components/booking/BookingList";
import { TrainerBookModal, type TrainerBookInit } from "@/components/booking/TrainerBookModal";
import { CredentialsModal, genPassword, GOALS, type Credentials } from "@/components/clients/ClientForms";
import { ClientOverview } from "@/components/clients/ClientOverview";
import { ImportClientsModal } from "@/components/clients/ImportClientsModal";
import { ClientPayments } from "@/components/payments/PayActions";
import { CoachIntake } from "@/components/intake/CoachIntake";
import { PlanTab } from "@/components/plan/PlanTab";
import { CoachNutrition } from "@/components/nutrition/CoachNutrition";
import { ProgressHub } from "@/components/progress/ProgressHub";
import { GymSelect } from "@/components/GymSelect";
import { HomeAddressField } from "@/components/HomeAddressField";
import { FocusPicker } from "@/components/sports/Focus";
import { NumberInput } from "@/components/NumberInput";
import { Badge, Button, Card, ConfirmDialog, Field, Input, PersonAvatar, SectionTitle, Select, Tabs, Textarea } from "@/components/ui";
import { isGymComplete } from "@/lib/gyms";
import { WorkoutHub } from "@/components/workout/WorkoutHub";
import { useViewer } from "@/lib/hooks";
import { availableCredits, reservedCount } from "@/lib/scheduling";
import { CreditHistory } from "@/components/attendance/CreditHistory";
import { adjustCredits, adjustGroupCreditsBy, deleteClient, resetClientPassword, updateClient } from "@/lib/store";
import type { ClientGoal } from "@/lib/types";

type Tab = "overview" | "plan" | "workouts" | "progress" | "nutrition" | "intake" | "sessions" | "profile";

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { db, clients, isTrainer } = useViewer();
  const [tab, setTab] = useState<Tab>("overview");
  const found = clients.find((c) => c.user.id === id);

  if (!isTrainer) return null;
  if (!found) {
    return (
      <Card className="p-8 text-center">
        <div className="font-semibold">Client not found</div>
        <Link href="/clients" className="mt-3 inline-block text-sm text-accent">
          Back to clients
        </Link>
      </Card>
    );
  }
  const { user, profile } = found;
  const avail = availableCredits(profile, db.bookings);

  return (
    <div>
      <Link href="/clients" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Clients
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <PersonAvatar user={user} size={60} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{user.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>@{user.username}</span>
            <Badge className="border-accent/30 bg-accent/15 text-accent">{profile.goal}</Badge>
            {profile.archived && <Badge>Archived</Badge>}
            <Badge className={avail <= 2 ? "border-danger/30 bg-danger/15 text-danger" : "border-success/30 bg-success/15 text-success"}>
              {profile.credits} credits · {avail} bookable
            </Badge>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "plan", label: "Plan" },
          { value: "workouts", label: "Workouts" },
          { value: "progress", label: "Progress" },
          { value: "nutrition", label: "Nutrition" },
          { value: "intake", tourId: "client-tab-intake", label: "Intake", icon: profile.intake && (profile.intake.needsReview || profile.intake.selfAssessments > 0) ? <span aria-label="Needs your attention" className="h-2 w-2 rounded-full bg-danger" /> : undefined },
          { value: "sessions", label: "Sessions" },
          { value: "profile", label: "Profile" },
        ]}
      />

      {tab === "overview" && <ClientOverview clientId={id} onTab={setTab} />}
      {tab === "plan" && <PlanTab clientId={id} />}
      {tab === "workouts" && <WorkoutHub clientId={id} />}
      {tab === "progress" && <ProgressHub clientId={id} />}
      {tab === "nutrition" && <CoachNutrition key={id} clientId={id} />}
      {tab === "intake" && <CoachIntake key={id} clientId={id} clientName={user.name} minor={!!user.isMinor} />}
      {tab === "sessions" && <Sessions clientId={id} />}
      {tab === "profile" && <ProfileTab key={id} clientId={id} />}
    </div>
  );
}

function Sessions({ clientId }: { clientId: string }) {
  const [init, setInit] = useState<TrainerBookInit | null>(null);
  const { clients } = useViewer();
  const name = clients.find((c) => c.user.id === clientId)?.user.name ?? "your client";
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setInit({ clientId })}>
          <CalendarPlus size={16} /> Book session
        </Button>
      </div>
      <ClientPayments clientId={clientId} clientName={name} />
      <CreditHistory clientId={clientId} />
      <BookingList clientId={clientId} filters={["upcoming", "past", "cancelled"]} />
      <TrainerBookModal init={init} onClose={() => setInit(null)} />
    </div>
  );
}

function DetailsCard({ clientId, onImport }: { clientId: string; onImport: () => void }) {
  const { clients } = useViewer();
  const found = clients.find((c) => c.user.id === clientId)!;
  const { user, profile } = found;
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.email);
  const [goal, setGoal] = useState<ClientGoal>(profile.goal);
  const [gym, setGym] = useState(profile.defaultGymId ?? "");
  const [medical, setMedical] = useState(profile.medicalNotes);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  return (
    <section>
        <SectionTitle
          action={
            <Button variant="secondary" size="sm" onClick={onImport}>
              <FileUp size={14} /> Update from details
            </Button>
          }
        >
          Client details
        </SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Username" hint="What this client signs in with. Changing it doesn't sign them out.">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} />
            </Field>
            <Field label="Phone / WhatsApp">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Goal">
              <Select value={goal} onChange={(e) => setGoal(e.target.value as ClientGoal)}>
                {GOALS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
            <Field label="Default gym">
              <GymSelect value={gym} onChange={setGym} noneLabel="None / decide later" />
            </Field>
          </div>
          <Field label="Training focus" hint="What this client trains. Their exercise picker (and yours, when you log for them) follows it.">
            <div />
          </Field>
          <FocusPicker clientId={clientId} />
          <HomeAddressField clientId={clientId} hint="Where you train this client at home. It’s saved as you type and offered as “Home” when booking." />
          <Field label="Medical / injury notes">
            <Textarea value={medical} onChange={(e) => setMedical(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Button
              disabled={!name.trim() || username.trim().length < 3}
              onClick={async () => {
                setActionError(null);
                if (gym && !isGymComplete(gym)) return setActionError("Please type the place name for the default gym.");
                const err = await updateClient(clientId, {
                  user: { name: name.trim(), username: username.trim().toLowerCase() },
                  profile: { phone: phone.trim(), email: email.trim(), goal, defaultGymId: gym || null, medicalNotes: medical.trim() },
                });
                if (err) return setActionError(err);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              }}
            >
              <Save size={16} /> Save changes
            </Button>
            {saved && <span className="text-sm text-success">Saved</span>}
            {actionError && <span className="text-sm text-danger">{actionError}</span>}
          </div>
        </Card>
      </section>
  );
}

function ProfileTab({ clientId }: { clientId: string }) {
  const [importing, setImporting] = useState(false);
  const [importRev, setImportRev] = useState(0);
  const { db, clients } = useViewer();
  const router = useRouter();
  const found = clients.find((c) => c.user.id === clientId)!;
  const { user, profile } = found;
  const [actionError, setActionError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [topUp, setTopUp] = useState(10);
  const [groupTopUp, setGroupTopUp] = useState(5);

  return (
    <div className="space-y-8">
      <DetailsCard key={importRev} clientId={clientId} onImport={() => setImporting(true)} />

      <section>
        <SectionTitle>Session package</SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-3xl font-bold">{profile.credits}</div>
              <div className="text-xs text-muted">sessions remaining · {reservedCount(db.bookings, clientId)} reserved by upcoming bookings</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" aria-label="Remove one credit" onClick={() => adjustCredits(clientId, -1)}>
                <Minus size={16} />
              </Button>
              <Button variant="secondary" aria-label="Add one credit" onClick={() => adjustCredits(clientId, 1)}>
                <Plus size={16} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <Field label="Sell a new package (sessions)">
              <NumberInput label="Sessions to add" min={1} max={1000} value={topUp} onChange={(v) => setTopUp(v ?? topUp)} className="w-40" />
            </Field>
            <Button
              disabled={topUp < 1}
              onClick={() => {
                adjustCredits(clientId, topUp, true);
              }}
            >
              Add {topUp} credits
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Group class credits</SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-3xl font-bold">{profile.groupClassCredits}</div>
              <div className="text-xs text-muted">group class credits remaining · {db.groups.filter((g) => g.status === "OPEN" && g.members?.some((m) => m.clientId === clientId && m.status === "CONFIRMED" && !m.attendance)).length} reserved by upcoming classes · taken when marked present</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" aria-label="Remove one group credit" disabled={profile.groupClassCredits < 1} onClick={async () => setActionError(await adjustGroupCreditsBy(clientId, -1))}>
                <Minus size={16} />
              </Button>
              <Button variant="secondary" aria-label="Add one group credit" onClick={async () => setActionError(await adjustGroupCreditsBy(clientId, 1))}>
                <Plus size={16} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <Field label="Add group class credits">
              <NumberInput label="Group credits to add" min={1} max={1000} value={groupTopUp} onChange={(v) => setGroupTopUp(v ?? groupTopUp)} className="w-40" />
            </Field>
            <Button disabled={groupTopUp < 1} onClick={async () => setActionError(await adjustGroupCreditsBy(clientId, groupTopUp))}>
              Add {groupTopUp} group credits
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Account</SectionTitle>
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setConfirmReset(true)}>
              <KeyRound size={16} /> Reset password
            </Button>
            <Button variant="secondary" onClick={async () => setActionError(await updateClient(clientId, { profile: { archived: !profile.archived } }))}>
              {profile.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {profile.archived ? "Reactivate client" : "Archive / deactivate"}
            </Button>
            <Button variant="danger" onClick={() => setConfirmDel(true)}>
              <Trash2 size={16} /> Delete client
            </Button>
          </div>
          <p className="text-xs text-muted">
            Archived clients can’t log in but keep all their history. Deleting permanently removes the account and every workout, check-in, photo and booking. It also removes any health forms, assessments and posture photos.
          </p>
          {actionError && <p className="text-sm text-danger">{actionError}</p>}
        </Card>
      </section>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset password?"
        message={`A new temporary password will be generated for ${user.name}. They’ll be asked to change it at next login.`}
        confirmLabel="Reset password"
        onConfirm={async () => {
          const pw = genPassword();
          const err = await resetClientPassword(clientId, pw);
          if (err) return setActionError(err);
          setCreds({ name: user.name, username: user.username, password: pw });
        }}
      />
      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        danger
        title={`Delete ${user.name}?`}
        message="This permanently deletes the client and all of their workouts, body metrics, progress photos, bookings, health forms and assessments. This cannot be undone."
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          const err = await deleteClient(clientId);
          if (err) return setActionError(err);
          router.replace("/clients");
        }}
      />
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} title="Password reset" />
      <ImportClientsModal open={importing} onClose={() => setImporting(false)} targetClientId={clientId} onDone={() => setImportRev((n) => n + 1)} />
    </div>
  );
}
