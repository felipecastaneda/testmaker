import { describe, expect, it } from "vitest";
import {
  attemptIsOver,
  availabilityOf,
  isValidJoinCode,
  JOIN_CODE_ALPHABET,
  makeJoinCode,
  normalizeJoinCode,
  validateAssignmentOptions,
} from "@/lib/assignments";

describe("join codes", () => {
  it("are 8 characters from an unambiguous alphabet", () => {
    let i = 0;
    const code = makeJoinCode((n) => i++ % n);
    expect(code).toBe("ABCDEFGH");
    expect(isValidJoinCode(code)).toBe(true);
    for (const confusing of "0O1IL") expect(JOIN_CODE_ALPHABET).not.toContain(confusing);
    const random = makeJoinCode((n) => Math.floor(Math.random() * n));
    expect(isValidJoinCode(random)).toBe(true);
  });

  it("normalize what students type", () => {
    expect(normalizeJoinCode(" k7qm-2xra ")).toBe("K7QM2XRA");
    expect(isValidJoinCode("K7QM2XR")).toBe(false);
    expect(isValidJoinCode("K7QM2XR0")).toBe(false);
  });
});

describe("availabilityOf", () => {
  const now = new Date("2026-12-01T10:00:00.000Z");
  const open = { status: "open" as const, opensAt: null, closesAt: null };

  it("follows the professor's status", () => {
    expect(availabilityOf({ ...open, status: "draft" }, now)).toBe("draft");
    expect(availabilityOf({ ...open, status: "closed" }, now)).toBe("closed");
    expect(availabilityOf(open, now)).toBe("open");
  });

  it("applies the time window to open assignments", () => {
    expect(availabilityOf({ ...open, opensAt: "2026-12-01T11:00:00.000Z" }, now)).toBe("scheduled");
    expect(availabilityOf({ ...open, opensAt: "2026-12-01T09:00:00.000Z" }, now)).toBe("open");
    expect(availabilityOf({ ...open, closesAt: "2026-12-01T10:00:00.000Z" }, now)).toBe("closed");
    expect(availabilityOf({ ...open, closesAt: "2026-12-01T10:30:00.000Z" }, now)).toBe("open");
  });
});

describe("validateAssignmentOptions", () => {
  const ok = { opensAt: null, closesAt: null, timeLimitMinutes: null };
  it("accepts sensible options", () => {
    expect(validateAssignmentOptions(ok)).toBeNull();
    expect(validateAssignmentOptions({ opensAt: "2026-12-01T09:00:00Z", closesAt: "2026-12-01T10:00:00Z", timeLimitMinutes: 45 })).toBeNull();
  });

  it.each([
    [{ ...ok, opensAt: "not a date" }, /opening time/],
    [{ ...ok, opensAt: "2026-12-01T10:00:00Z", closesAt: "2026-12-01T09:00:00Z" }, /after the opening/],
    [{ ...ok, timeLimitMinutes: 0 }, /between 1 and 600/],
    [{ ...ok, timeLimitMinutes: 12.5 }, /whole number/],
    [{ ...ok, timeLimitMinutes: 601 }, /between 1 and 600/],
  ])("rejects %o", (options, message) => {
    expect(validateAssignmentOptions(options)).toMatch(message);
  });
});

describe("attemptIsOver", () => {
  const now = Date.parse("2026-12-01T10:00:00.000Z");
  const open = { status: "open" as const, closesAt: null };

  it("ends at the deadline plus a 30-second grace", () => {
    expect(attemptIsOver(open, { deadline: "2026-12-01T09:59:40.000Z" }, now)).toBe(false);
    expect(attemptIsOver(open, { deadline: "2026-12-01T09:59:20.000Z" }, now)).toBe(true);
    expect(attemptIsOver(open, { deadline: null }, now)).toBe(false);
  });

  it("ends when the professor closes the exam, even with extra time", () => {
    expect(attemptIsOver({ status: "closed" }, { deadline: null }, now)).toBe(true);
    expect(attemptIsOver({ status: "closed" }, { deadline: "2026-12-01T11:00:00.000Z", extended: true }, now)).toBe(true);
  });

  it("ends when the window closes, unless the student was given extra time", () => {
    const pastClose = { status: "open" as const, closesAt: "2026-12-01T09:00:00.000Z" };
    expect(attemptIsOver(pastClose, { deadline: "2026-12-01T10:30:00.000Z" }, now)).toBe(true);
    expect(attemptIsOver(pastClose, { deadline: "2026-12-01T10:30:00.000Z", extended: true }, now)).toBe(false);
  });
});
