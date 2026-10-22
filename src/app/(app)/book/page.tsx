"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { Card, PageHeader, SectionTitle, Tabs } from "@/components/ui";
import { ClassList } from "@/components/groups/ClassList";
import { BookingList } from "@/components/booking/BookingList";
import { SyncAllButton } from "@/components/booking/CalendarActions";
import { ScheduleBoard } from "@/components/booking/ScheduleBoard";
import { useViewer } from "@/lib/hooks";
import { availableCredits, reservedCount } from "@/lib/scheduling";

export default function BookPage() {
  const { user, db } = useViewer();
  const [tab, setTab] = useState<"sessions" | "classes">("sessions");
  if (!user) return null;
  const profile = db.clients.find((c) => c.id === user.id);
  const reserved = reservedCount(db.bookings, user.id);
  const avail = profile ? availableCredits(profile, db.bookings) : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Book a Session"
        subtitle={`Tap an available slot · ${db.settings.sessionMinutes}-minute sessions · ${db.settings.noticeHours}h notice to book or cancel`}
        actions={<SyncAllButton clientId={user.id} />}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "sessions", label: "1-on-1 sessions" },
          { value: "classes", label: db.groupRequests.some((r) => r.needsMe) ? "Group classes (1 to answer)" : "Group classes" },
        ]}
      />

      {tab === "classes" && <ClassList mode="client" />}

      {tab === "sessions" && profile && (
        <Card className="grid grid-cols-3 divide-x divide-line p-4 text-center">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Remaining</div>
            <div className="mt-1 text-2xl font-bold">{profile.credits}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Reserved</div>
            <div className="mt-1 text-2xl font-bold text-pr">{reserved}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Available to book</div>
            <div className={`mt-1 text-2xl font-bold ${avail > 0 ? "text-success" : "text-danger"}`}>{avail}</div>
          </div>
        </Card>
      )}

      {tab === "sessions" && <ScheduleBoard mode="client" clientId={user.id} />}

      {tab === "sessions" && (
        <section>
          <SectionTitle>
            <span className="inline-flex items-center gap-2">
              <CalendarClock size={14} /> My sessions
            </span>
          </SectionTitle>
          <BookingList clientId={user.id} filters={["upcoming", "past", "cancelled"]} />
        </section>
      )}
    </div>
  );
}
