"use client";

import { Megaphone } from "lucide-react";
import { useState } from "react";
import { Button, Field, Modal, Notice, Textarea } from "@/components/ui";
import { broadcastChat } from "@/lib/chat";

/** Owner-only: send one message to every active coach. */
export function BroadcastModal({ open, onClose, count }: { open: boolean; onClose: () => void; count: number }) {
  return open ? <Form onClose={onClose} count={count} /> : null;
}

function Form({ onClose, count }: { onClose: () => void; count: number }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Announcement to all coaches"
      footer={
        sent ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!text.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const err = await broadcastChat(text.trim());
                setBusy(false);
                if (err) setError(err);
                else setSent(true);
              }}
            >
              <Megaphone size={16} /> {busy ? "Sending…" : `Send to ${count} coach${count === 1 ? "" : "es"}`}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <Notice tone="success">Sent to {count} coach{count === 1 ? "" : "es"}. They will see it as an announcement from you (App Owner) and get an email.</Notice>
      ) : (
        <div className="space-y-3">
          <Field label="Message" hint="Each coach receives it in their own Owner conversation and can reply there.">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="e.g. New feature released — please test the booking calendar and send feedback." autoFocus />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}
