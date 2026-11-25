import type { AssignmentAvailability, AssignmentOptions, AssignmentStatus } from "./types";

/** Letters and digits that can't be confused when read aloud or off a projector (no 0/O, 1/I/L). */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;
export const MAX_TIME_LIMIT_MINUTES = 600;

/** A random join code, e.g. "K7QM2XRA". `random` returns integers in [0, n) (injectable for tests). */
export function makeJoinCode(random: (n: number) => number): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET[random(JOIN_CODE_ALPHABET.length)];
  return code;
}

/** Upper-case and drop spaces/dashes, so "k7qm-2xra" finds "K7QM2XRA". */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

export function isValidJoinCode(code: string): boolean {
  return code.length === JOIN_CODE_LENGTH && [...code].every((c) => JOIN_CODE_ALPHABET.includes(c));
}

/** Whether students can start now, given the professor's status and the time window. */
export function availabilityOf(
  a: { status: AssignmentStatus; opensAt: string | null; closesAt: string | null },
  now: Date = new Date()
): AssignmentAvailability {
  if (a.status !== "open") return a.status;
  const t = now.toISOString();
  if (a.opensAt && t < a.opensAt) return "scheduled";
  if (a.closesAt && t >= a.closesAt) return "closed";
  return "open";
}

/** A user-facing problem with these options, or null. */
export function validateAssignmentOptions(o: Pick<AssignmentOptions, "opensAt" | "closesAt" | "timeLimitMinutes">): string | null {
  for (const [name, value] of [["opening", o.opensAt], ["closing", o.closesAt]] as const) {
    if (value !== null && Number.isNaN(Date.parse(value))) return `The ${name} time isn't a valid date.`;
  }
  if (o.opensAt && o.closesAt && Date.parse(o.closesAt) <= Date.parse(o.opensAt)) {
    return "The closing time must be after the opening time.";
  }
  if (o.timeLimitMinutes !== null) {
    if (!Number.isInteger(o.timeLimitMinutes) || o.timeLimitMinutes < 1 || o.timeLimitMinutes > MAX_TIME_LIMIT_MINUTES) {
      return `The time limit must be a whole number of minutes between 1 and ${MAX_TIME_LIMIT_MINUTES}.`;
    }
  }
  return null;
}

/** Attempts may finish this long after their deadline (network lag, auto-submit). */
export const DEADLINE_GRACE_MS = 30_000;

/**
 * Is a student's attempt over? Its own deadline passed (plus grace), the professor closed
 * the exam, or the window closed. Extra time from the professor outlasts the window, but
 * not "Close now".
 */
export function attemptIsOver(
  assignment: { status: AssignmentStatus; opensAt?: string | null; closesAt?: string | null },
  attempt: { deadline?: string | null; extended?: boolean },
  now: number = Date.now()
): boolean {
  const deadline = attempt.deadline ?? null;
  if (deadline !== null && now > Date.parse(deadline) + DEADLINE_GRACE_MS) return true;
  if (assignment.status === "closed") return true;
  if (attempt.extended === true) return false;
  return availabilityOf({ status: assignment.status, opensAt: assignment.opensAt ?? null, closesAt: assignment.closesAt ?? null }, new Date(now)) === "closed";
}

/** Student limit per assignment: an abuse guard against someone joining with made-up IDs. */
export const DEFAULT_MAX_STUDENTS = 200;
export const MAX_STUDENTS_LIMIT = 2_000;
