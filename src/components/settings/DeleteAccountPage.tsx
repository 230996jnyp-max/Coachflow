"use client";

import { useEffect, useState } from "react";
import { DeleteAccount } from "@/components/settings/DeleteAccount";

/** Reads the emailed link's token from the address and shows the delete form. */
export function DeleteAccountPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      await Promise.resolve();
      if (live) setToken(new URLSearchParams(window.location.search).get("token"));
    })();
    return () => {
      live = false;
    };
  }, []);
  if (token === undefined) return <p className="text-sm text-muted">Loading…</p>;
  return <DeleteAccount token={token ?? undefined} />;
}
