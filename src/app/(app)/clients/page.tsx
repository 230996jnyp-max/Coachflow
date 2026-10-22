"use client";

import { format, parseISO } from "date-fns";
import { ChevronRight, Plus, Search, Ticket, UserPlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AddClientModal, CredentialsModal, type Credentials } from "@/components/clients/ClientForms";
import { Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Segmented } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { availableCredits } from "@/lib/scheduling";
import { doneWorkouts } from "@/lib/stats";
import { useNow } from "@/lib/store";

export default function ClientsPage() {
  const { db, clients } = useViewer();
  const now = useNow(60_000);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [adding, setAdding] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const rows = useMemo(() => {
    return clients
      .filter((c) => (filter === "all" ? true : filter === "archived" ? c.profile.archived : !c.profile.archived))
      .filter((c) => !q.trim() || `${c.user.name} ${c.user.username} ${c.profile.goal}`.toLowerCase().includes(q.trim().toLowerCase()));
  }, [clients, filter, q]);

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${clients.filter((c) => !c.profile.archived).length} active clients`}
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add client
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-9" />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={28} />}
          title="No clients found"
          hint="Create a client account and share the login details with them."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> Add client
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ user, profile }) => {
            const avail = availableCredits(profile, db.bookings);
            const next = db.bookings
              .filter((b) => b.clientId === user.id && (b.status === "CONFIRMED" || b.status === "PENDING") && parseISO(b.start) > now)
              .sort((a, b) => a.start.localeCompare(b.start))[0];
            const last = doneWorkouts(db.workouts, user.id).pop();
            return (
              <Link key={user.id} href={`/clients/${user.id}`}>
                <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-accent/50">
                  <div className="flex items-center gap-3">
                    <Avatar name={user.name} size={46} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{user.name}</div>
                      <div className="truncate text-xs text-muted">@{user.username}</div>
                    </div>
                    {profile.archived ? <Badge>Archived</Badge> : <Badge className="border-accent/30 bg-accent/15 text-accent">{profile.goal}</Badge>}
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-field py-2">
                      <div className="flex items-center justify-center gap-1 text-lg font-bold">
                        <Ticket size={14} className={avail <= 2 ? "text-danger" : "text-accent"} />
                        <span className={avail <= 2 ? "text-danger" : ""}>{profile.credits}</span>
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Credits · {profile.groupClassCredits} group</div>
                    </div>
                    <div className="rounded-xl bg-field py-2">
                      <div className="text-sm font-bold leading-7">{next ? format(parseISO(next.start), "EEE d MMM") : "—"}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Next session</div>
                    </div>
                    <div className="rounded-xl bg-field py-2">
                      <div className="text-sm font-bold leading-7">{last ? format(parseISO(last.startedAt), "d MMM") : "—"}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Last workout</div>
                    </div>
                  </div>
                  {user.mustChangePassword && <div className="text-[11px] font-semibold text-pr">Still on temporary password</div>}
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <AddClientModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(_id, c) => {
          setAdding(false);
          setCreds(c);
        }}
      />
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}
