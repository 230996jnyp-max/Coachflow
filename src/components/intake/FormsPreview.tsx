"use client";

import { ClipboardCheck, Eye } from "lucide-react";
import { useState } from "react";
import { FormFill } from "@/components/intake/FormParts";
import { Button, Modal, Notice } from "@/components/ui";
import { FORM_BLURB, FORM_KINDS, FORM_LABEL, PRIVACY_NOTE, type FormKind } from "@/lib/intakeForms";
import { cn } from "@/lib/utils";

/*
 * Lets a coach see the "Before we meet" forms exactly as a client sees them, before sending anything. View only: the fields work so
 * the coach can click through, but nothing is saved or sent. Used in Settings, on the Add client form and on a client's Intake tab.
 */

/** The three forms as a short list, each with a Preview button. The parent shows the modal (so it can sit outside another dialog). */
export function FormsPreviewRows({ onPreview, highlight = false }: { onPreview: (k: FormKind) => void; highlight?: boolean }) {
  return (
    <ul className={cn("divide-y divide-line overflow-hidden rounded-xl border", highlight ? "border-accent/50 bg-accent/5" : "border-line")}>
      {FORM_KINDS.map((k) => (
        <li key={k} className="flex items-center gap-3 p-3">
          <ClipboardCheck size={18} className="shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{FORM_LABEL[k]}</div>
            <div className="text-xs text-muted">{FORM_BLURB[k]}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onPreview(k)} aria-label={`Preview the ${FORM_LABEL[k].toLowerCase()}`}>
            <Eye size={14} /> Preview
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** One form, as the client sees it. Closed when `kind` is null. */
export function FormPreviewModal({ kind, onClose }: { kind: FormKind | null; onClose: () => void }) {
  const [minor, setMinor] = useState(false);
  if (!kind) return null;
  return (
    <Modal open wide onClose={onClose} title={`Preview: ${FORM_LABEL[kind]}`}>
      <div className="space-y-4">
        <Notice tone="info">This is what your client sees. You can click through it, but nothing is saved or sent.</Notice>
        <p className="text-xs text-muted">{PRIVACY_NOTE}</p>
        {kind === "DECLARATION" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
            <span>Show it as a client under 18 would see it (a parent or guardian signs too)</span>
          </label>
        )}
        <FormFill key={`${kind}-${minor}`} kind={kind} minor={minor} clientName="Sam Lee" preview onSubmit={async () => null} onCancel={onClose} />
      </div>
    </Modal>
  );
}
