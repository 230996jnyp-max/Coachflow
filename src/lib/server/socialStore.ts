import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { oauthIdentities } from "./schema";

export type ProviderId = "google" | "facebook" | "microsoft";
export const PROVIDER_IDS: ProviderId[] = ["google", "facebook", "microsoft"];
export const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as string[]).includes(v);

/** Whose provider account this is (or null). Never throws for an unknown account. */
export async function findIdentity(provider: ProviderId, subject: string): Promise<{ userId: string } | null> {
  const d = await db();
  const [row] = await d.select({ userId: oauthIdentities.userId }).from(oauthIdentities).where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.subject, subject))).limit(1);
  return row ?? null;
}

export async function linkIdentity(provider: ProviderId, subject: string, userId: string, email: string): Promise<void> {
  const d = await db();
  await d.insert(oauthIdentities).values({ provider, subject, userId, email: email.slice(0, 200) }).onConflictDoNothing();
}

export async function unlinkIdentity(provider: ProviderId, subject: string): Promise<void> {
  const d = await db();
  await d.delete(oauthIdentities).where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.subject, subject)));
}

/** The providers a person has connected. */
export async function identitiesOf(userId: string): Promise<ProviderId[]> {
  const d = await db();
  const rows = await d.select({ provider: oauthIdentities.provider }).from(oauthIdentities).where(eq(oauthIdentities.userId, userId));
  return rows.map((r) => r.provider).filter(isProvider);
}
