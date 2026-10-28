"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { changeUsername } from "@/lib/store";

/** Change your own username. Coaches can also keep signing in with their email. Saves with its own button. */
export function UsernameField() {
  const { user, isTrainer } = useViewer();
  const [value, setValue] = useState(user?.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!user) return null;
  const clean = value.trim().toLowerCase();
  const changed = clean !== user.username && clean.length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await changeUsername(clean);
    setBusy(false);
    if (err) return setError(err);
    setValue(clean);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-2">
      <Field label="Username" hint={isTrainer ? "You can sign in with this or with your email. Letters, numbers, dots, dashes and underscores." : "You sign in with this. Letters, numbers, dots, dashes and underscores."}>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && changed && !busy) {
                e.preventDefault();
                void save();
              }
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={100}
            aria-label="Username"
          />
          <Button variant="secondary" onClick={() => void save()} disabled={!changed || busy}>
            {saved ? <Check size={16} /> : null} {busy ? "Saving…" : saved ? "Saved" : "Change"}
          </Button>
        </div>
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
