"use client";

import { ChevronRight, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { FORM_LABEL, type FormKind } from "@/lib/intakeForms";

/** On a client's home: forms their coach asked for that aren't filled in yet, and copies waiting to be read. Shows nothing otherwise. */
export function IntakeCard() {
  const { user } = useViewer();
  const missing = (user?.intake?.missing ?? []) as FormKind[];
  const toAck = user?.intake?.toAcknowledge ?? 0;
  if (!user || (missing.length === 0 && toAck === 0)) return null;
  return (
    <Link href="/intake" className="block">
      <Card className="flex items-center gap-3 border-accent/40 bg-accent-dim/40 p-4">
        <ClipboardCheck size={22} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{missing.length > 0 ? "Before we meet" : "Please read your copy"}</div>
          <div className="text-sm text-muted">
            {missing.length > 0 && `Your coach asked you to fill in: ${missing.map((k) => FORM_LABEL[k].toLowerCase()).join(", ")}. About five minutes.`}
            {missing.length > 0 && toAck > 0 && " "}
            {toAck > 0 && `${toAck} ${toAck === 1 ? "copy is" : "copies are"} waiting for you to read and acknowledge.`}
          </div>
        </div>
        <ChevronRight size={18} className="text-muted" />
      </Card>
    </Link>
  );
}
