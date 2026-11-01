"use client";

import { format, parseISO } from "date-fns";
import { Check, Mail, Phone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Notice, SectionTitle } from "@/components/ui";
import { setPendingCount } from "@/lib/adminPending";
import { api } from "@/lib/store";

interface Req {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS: Record<Req["status"], { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "border-pr/30 bg-pr/15 text-pr" },
  APPROVED: { label: "Approved", cls: "border-success/30 bg-success/15 text-success" },
  REJECTED: { label: "Declined", cls: "border-danger/30 bg-danger/15 text-danger" },
};

/**
 * Coach sign-up requests. The green tick makes the coach account and emails their login; the red cross declines and emails the
 * applicant. If the approval email can't be sent, nothing is created and the request stays here to try again.
 */
export function PendingApprovals({ onApproved }: { onApproved: () => void }) {
  const [list, setList] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "warn" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ requests: Req[]; pending: number }>("/api/admin/requests");
    if (r.ok && r.data) {
      setList(r.data.requests);
      setPendingCount(r.data.pending);
    } else setNotice({ tone: "error", text: r.error ?? "Could not load the requests." });
  }, []);

  useEffect(() => {
    let alive = true;
    api<{ requests: Req[]; pending: number }>("/api/admin/requests").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setList(r.data.requests);
        setPendingCount(r.data.pending);
      } else setNotice({ tone: "error", text: r.error ?? "Could not load the requests." });
    });
    return () => {
      alive = false;
    };
  }, []);

  const act = async (r: Req, action: "approve" | "decline") => {
    setBusy(r.id);
    setNotice(null);
    const res = await api<{ emailed?: boolean }>(`/api/admin/requests/${r.id}`, { body: { action } });
    setBusy(null);
    if (!res.ok) setNotice({ tone: "error", text: res.error ?? "That didn't work. Please try again." });
    else if (action === "approve") {
      setNotice({ tone: "success", text: `${r.fullName} is approved. Their login details were emailed to ${r.email}.` });
      onApproved();
    } else if (res.data?.emailed === false) setNotice({ tone: "warn", text: `${r.fullName} was declined, but the email to ${r.email} couldn't be delivered.` });
    else setNotice({ tone: "success", text: `${r.fullName} was declined and has been emailed.` });
    await load();
  };

  const pending = (list ?? []).filter((r) => r.status === "PENDING");
  const history = (list ?? []).filter((r) => r.status !== "PENDING");

  return (
    <div className="space-y-6">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <section>
        <SectionTitle>Waiting for your decision</SectionTitle>
        <div className="space-y-2">
          {list === null && <Card className="p-6 text-center text-sm text-muted">Loading…</Card>}
          {list !== null && pending.length === 0 && <Card className="p-6 text-center text-sm text-muted">No coach requests are waiting.</Card>}
          {pending.map((r) => (
            <Card key={r.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold">{r.fullName}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                    <Mail size={14} /> <span className="truncate">{r.email}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                    <Phone size={14} /> {r.phone || "—"}
                  </div>
                  <div className="mt-1 text-xs text-muted">Submitted {format(parseISO(r.createdAt), "d MMM yyyy, HH:mm")}</div>
                </div>
                <Badge className={STATUS.PENDING.cls}>{STATUS.PENDING.label}</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="success" className="flex-1" disabled={busy !== null} onClick={() => void act(r, "approve")} aria-label={`Approve ${r.fullName}`}>
                  <Check size={18} strokeWidth={3} /> {busy === r.id ? "Working…" : "Approve"}
                </Button>
                <Button variant="danger" className="flex-1" disabled={busy !== null} onClick={() => void act(r, "decline")} aria-label={`Decline ${r.fullName}`}>
                  <X size={18} strokeWidth={3} /> Decline
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {history.length > 0 && (
        <section>
          <SectionTitle>Earlier requests</SectionTitle>
          <div className="space-y-2">
            {history.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.fullName}</div>
                  <div className="truncate text-sm text-muted">
                    {r.email} · {r.phone || "—"}
                  </div>
                  <div className="text-xs text-muted">
                    Submitted {format(parseISO(r.createdAt), "d MMM yyyy, HH:mm")}
                    {r.reviewedAt ? ` · answered ${format(parseISO(r.reviewedAt), "d MMM yyyy, HH:mm")}` : ""}
                  </div>
                </div>
                <Badge className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
