import { useEffect, useState } from "react";
import { api } from "./store";

const memory = new Map<string, string | null>();

/**
 * One short AI-written sentence for some facts (a "why" for a suggestion, a client brief for the coach). It is only asked for when
 * `enabled`, kept in memory (and on the server) so the same facts are never written twice, and is null whenever the AI is
 * unavailable, so a screen can always fall back to its own wording.
 */
export function useAiNote(kind: "why" | "eye", facts: string, enabled: boolean): string | null {
  const key = enabled ? `${kind}|${facts}` : "";
  const [got, setGot] = useState<{ key: string; text: string | null }>({ key: "", text: null });
  useEffect(() => {
    if (!key) return;
    if (memory.has(key)) {
      void Promise.resolve().then(() => setGot({ key, text: memory.get(key) ?? null }));
      return;
    }
    let alive = true;
    void api<{ text: string | null }>("/api/ai/note", { body: { kind, facts } }).then((r) => {
      const text = r.ok ? (r.data?.text ?? null) : null;
      memory.set(key, text);
      if (alive) setGot({ key, text });
    });
    return () => {
      alive = false;
    };
  }, [key, kind, facts]);
  return got.key === key ? got.text : null;
}
