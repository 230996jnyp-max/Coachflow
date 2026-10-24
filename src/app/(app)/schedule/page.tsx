"use client";

import { useState } from "react";
import { AvailabilityManager } from "@/components/booking/AvailabilityManager";
import { BookingList } from "@/components/booking/BookingList";
import { SyncAllButton } from "@/components/booking/CalendarActions";
import { CalendarFeedButton } from "@/components/booking/CalendarFeed";
import { ScheduleBoard } from "@/components/booking/ScheduleBoard";
import { PendingAttendance } from "@/components/attendance/PendingAttendance";
import { ClassList } from "@/components/groups/ClassList";
import { PageHeader, Tabs } from "@/components/ui";
import { useViewer } from "@/lib/hooks";

type Tab = "calendar" | "classes" | "availability" | "bookings";

export default function SchedulePage() {
  const [tab, setTab] = useState<Tab>("calendar");
  const { db } = useViewer();
  const pending = db.bookings.filter((b) => b.status === "PENDING").length;
  const answers = db.groupRequests.filter((r) => r.needsMe).length;
  return (
    <div>
      <PageHeader title="Schedule" subtitle="Master calendar, group classes, availability and booking requests" actions={
          <>
            <CalendarFeedButton />
            <SyncAllButton />
          </>
        } />
      <div className="mb-5 empty:hidden">
        <PendingAttendance />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "calendar", label: "Calendar" },
          { value: "classes", label: answers ? `Classes (${answers} to answer)` : "Classes" },
          { value: "availability", label: "Availability" },
          { value: "bookings", label: pending ? `Bookings (${pending} pending)` : "Bookings" },
        ]}
      />
      {tab === "calendar" && <ScheduleBoard mode="trainer" />}
      {tab === "classes" && <ClassList mode="coach" />}
      {tab === "availability" && <AvailabilityManager />}
      {tab === "bookings" && <BookingList filters={pending ? ["pending", "upcoming", "past", "cancelled"] : ["upcoming", "pending", "past", "cancelled"]} />}
    </div>
  );
}
