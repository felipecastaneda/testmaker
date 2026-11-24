import "server-only";
import { adminDb } from "./admin";

/*
 * Platform-wide settings, stored in _meta/platform:
 *   { signupMode: "allowlist" | "open", allowedEmails: string[] }
 * Seeded by scripts/migrate-step1.ts; edited from the Settings page in a later PR.
 * The ALLOWED_EMAILS env var keeps working alongside it.
 */

export type SignupMode = "allowlist" | "open";

export interface PlatformConfig {
  signupMode: SignupMode;
  allowedEmails: Set<string>;
}

const CACHE_MS = 30_000;
let cache: { value: PlatformConfig; expires: number } | undefined;

export async function getPlatformConfig(): Promise<PlatformConfig> {
  // Cached briefly in production so the signup gate doesn't cost a read per request.
  const useCache = process.env.NODE_ENV === "production";
  if (useCache && cache && cache.expires > Date.now()) return cache.value;

  const snap = await adminDb().collection("_meta").doc("platform").get();
  const emails: unknown = snap.get("allowedEmails");
  const value: PlatformConfig = {
    signupMode: snap.get("signupMode") === "open" ? "open" : "allowlist",
    allowedEmails: new Set(
      Array.isArray(emails)
        ? emails.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase())
        : []
    ),
  };
  if (useCache) cache = { value, expires: Date.now() + CACHE_MS };
  return value;
}

export async function updatePlatformConfig(change: { signupMode: SignupMode; allowedEmails: string[] }): Promise<void> {
  await adminDb()
    .collection("_meta")
    .doc("platform")
    .set(
      {
        signupMode: change.signupMode,
        allowedEmails: [...new Set(change.allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  cache = undefined;
}
