import "server-only";
import { isMinorRow } from "./accounts";
import { forbidden } from "./http";
import type { UserRow } from "./schema";

/** AI features and calorie tracking are off for anyone under 18 (known from the birth date they gave at sign-up). */
export const MINOR_MESSAGE = "This feature isn't available for under-18s.";
export function requireAdult(me: UserRow): void {
  if (isMinorRow(me)) throw forbidden(MINOR_MESSAGE);
}
