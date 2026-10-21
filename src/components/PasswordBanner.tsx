"use client";

import Link from "next/link";
import { useViewer } from "@/lib/hooks";
import { Notice } from "./ui";

export function PasswordBanner() {
  const { user } = useViewer();
  if (!user?.mustChangePassword) return null;
  return (
    <div className="mb-4">
      <Notice
        tone="warn"
        action={
          <Link href="/settings/password" className="inline-flex min-h-11 items-center rounded-lg bg-pr px-3 text-xs font-bold text-black">
            Set my password
          </Link>
        }
      >
        You’re using a temporary password from your coach. Set your own personal password to secure your account.
      </Notice>
    </div>
  );
}
