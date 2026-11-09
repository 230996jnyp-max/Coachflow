"use client";

import { Dumbbell } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeMenu } from "@/components/ThemeSwitcher";
import { Card } from "@/components/ui";

/** The plain centred card used by the sign-up helper pages (confirm email, forgot / reset password). */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="pt-safe pb-safe animate-fade-in flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeMenu />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-lg shadow-accent/30">
            <Dumbbell size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <Card className="p-5">{children}</Card>
      </div>
    </div>
  );
}
