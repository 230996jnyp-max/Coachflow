import { Crown } from "lucide-react";
import type { ChatRole } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Which badge a person gets inside a conversation. The owner is a coach to their own clients, so the "App Owner"
 * badge only shows in owner ↔ coach conversations (`o:` threads).
 */
export function badgeRole(thread: string, role: ChatRole): ChatRole {
  return role === "OWNER" && thread.startsWith("c:") ? "COACH" : role;
}

const STYLES: Record<ChatRole, { label: string; cls: string }> = {
  OWNER: { label: "App Owner", cls: "border-pr/40 bg-pr/15 text-pr" },
  COACH: { label: "Coach", cls: "border-accent/40 bg-accent/15 text-accent" },
  CLIENT: { label: "Client", cls: "border-success/40 bg-success/15 text-success" },
};

export function RoleBadge({ role, className }: { role: ChatRole; className?: string }) {
  const s = STYLES[role];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-bold leading-4", s.cls, className)}>
      {role === "OWNER" && <Crown size={9} />}
      {s.label}
    </span>
  );
}
