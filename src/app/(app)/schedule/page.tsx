"use client";

import { useState } from "react";
import { AvailabilityManager } from "@/components/booking/AvailabilityManager";
import { BookingList } from "@/components/booking/BookingList";
import { SyncAllButton } from "@/components/booking/CalendarActions";
import { CalendarFeedButton } from "@/components/booking/CalendarFeed";
import { ScheduleBoard } from "@/components/booking/ScheduleBoard";
import { PageHeader, Tabs } from "@/components/ui";
import { useViewer } from "@/lib/hooks";

type Tab = "calendar" | "availability" | "bookings";

export default function SchedulePage() {
  const [tab, setTab] = useState<Tab>("calendar");
  const { db } = useViewer();
  const pending = db.bookings.filter((b) => b.status === "PENDING").length;
  return (
    <div>
      <PageHeader title="Schedule" subtitle="Master calendar, availability and booking requests" actions={
          <>
            <CalendarFeedButton />
            <SyncAllButton />
          </>
        } />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "calendar", label: "Calendar" },
          { value: "availability", label: "Availability" },
          { value: "bookings", label: pending ? `Bookings (${pending} pending)` : "Bookings" },
        ]}
      />
      {tab === "calendar" && <ScheduleBoard mode="trainer" />}
      {tab === "availability" && <AvailabilityManager />}
      {tab === "bookings" && <BookingList filters={pending ? ["pending", "upcoming", "past", "cancelled"] : ["upcoming", "pending", "past", "cancelled"]} />}
    </div>
  );
}
