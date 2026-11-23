import "server-only";

function parseEmailList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Server-side settings. In production these come from App Hosting secrets
 * (see apphosting.yaml); locally from .env.local.
 */
export const serverConfig = {
  get allowedEmails() {
    return parseEmailList(process.env.ALLOWED_EMAILS);
  },
  /** Tests created before accounts existed are given to this user on first sign-in. */
  get legacyOwnerEmail() {
    return process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase() || null;
  },
  get dailyQuestionLimit() {
    const n = Number(process.env.DAILY_QUESTION_LIMIT);
    return Number.isFinite(n) && n > 0 ? n : 300;
  },
  /**
   * Replace the LLM with canned output. Only honoured outside production so a
   * misconfigured deploy can never serve fake questions.
   */
  get fakeAi() {
    return process.env.TESTMAKER_FAKE_AI === "1" && process.env.NODE_ENV !== "production";
  },
};
