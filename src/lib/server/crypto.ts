import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomInt } from "node:crypto";

/*
 * AES-256-GCM field encryption. Output format: v1.<iv>.<tag>.<ciphertext> (base64url).
 * `aad` (additional authenticated data) binds a ciphertext to the row it belongs to — e.g. `profile:<userId>` or
 * `msg:<thread>` — so a ciphertext copied onto another row fails authentication instead of decrypting.
 */

let cachedKey: Buffer | undefined;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
  cachedKey = buf;
  return buf;
}

export function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(token: string, aad: string): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export const encryptJson = (value: unknown, aad: string) => encrypt(JSON.stringify(value), aad);
export const decryptJson = <T>(token: string, aad: string): T => JSON.parse(decrypt(token, aad)) as T;

const WORDS = ["amber", "bold", "cedar", "delta", "ember", "forge", "grove", "harbor", "iron", "jade", "knight", "lunar", "maple", "nova", "onyx", "pilot", "quartz", "raven", "stone", "tiger", "umber", "vivid", "willow", "zephyr"];

/** Human-friendly temporary password, e.g. "Raven-Cedar-4821-x" (≈ 50 bits of randomness). */
export function tempPassword(): string {
  const w = () => {
    const s = WORDS[randomInt(WORDS.length)];
    return s[0].toUpperCase() + s.slice(1);
  };
  return `${w()}-${w()}-${randomInt(1000, 10000)}-${"abcdefghjkmnpqrstuvwxyz"[randomInt(23)]}`;
}
