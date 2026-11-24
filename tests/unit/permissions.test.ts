import { describe, expect, it } from "vitest";
import { assignableRoles, canChangeMember, canCreateCourses, courseAccess, isOrgAdmin } from "@/lib/permissions";
import type { CourseRole, OrgRole } from "@/lib/types";

const all = { view: true, edit: true, manage: true };
const none = { view: false, edit: false, manage: false };

describe("courseAccess", () => {
  const cases: [OrgRole | null, CourseRole | null, boolean, typeof all][] = [
    // Org owners and admins see and manage every course in their org.
    ["owner", null, false, all],
    ["admin", null, false, all],
    // Instructors only reach courses they're staff on.
    ["instructor", "instructor", false, all],
    ["instructor", null, false, none],
    ["assistant", null, false, none],
    // Assistants view; edit only when the course allows it.
    ["assistant", "assistant", false, { view: true, edit: false, manage: false }],
    ["assistant", "assistant", true, { view: true, edit: true, manage: false }],
    ["instructor", "assistant", false, { view: true, edit: false, manage: false }],
    // Leaving the org removes access even if still listed as course staff.
    [null, "instructor", true, none],
    [null, "assistant", true, none],
    [null, null, true, none],
  ];

  it.each(cases)("org %s, course %s, assistantsCanEdit=%s", (orgRole, courseRole, assistantsCanEdit, expected) => {
    expect(courseAccess({ orgRole, courseRole, assistantsCanEdit })).toEqual(expected);
  });
});

describe("isOrgAdmin", () => {
  it("is true only for owners and admins", () => {
    expect(["owner", "admin", "instructor", "assistant", null].map((r) => isOrgAdmin(r as OrgRole | null))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("canCreateCourses", () => {
  it("lets admins always, instructors when allowed, never assistants or non-members", () => {
    expect(canCreateCourses("owner", false)).toBe(true);
    expect(canCreateCourses("admin", false)).toBe(true);
    expect(canCreateCourses("instructor")).toBe(true);
    expect(canCreateCourses("instructor", false)).toBe(false);
    expect(canCreateCourses("assistant")).toBe(false);
    expect(canCreateCourses(null)).toBe(false);
  });
});

describe("canChangeMember", () => {
  it("lets owners do anything", () => {
    expect(canChangeMember("owner", "owner", null)).toBe(true);
    expect(canChangeMember("owner", null, "owner")).toBe(true);
  });

  it("stops admins from creating, changing or removing owners", () => {
    expect(canChangeMember("admin", null, "admin")).toBe(true);
    expect(canChangeMember("admin", "instructor", "assistant")).toBe(true);
    expect(canChangeMember("admin", "instructor", null)).toBe(true);
    expect(canChangeMember("admin", null, "owner")).toBe(false);
    expect(canChangeMember("admin", "owner", "admin")).toBe(false);
    expect(canChangeMember("admin", "owner", null)).toBe(false);
  });

  it("gives instructors, assistants and non-members no say", () => {
    for (const actor of ["instructor", "assistant", null] as const) {
      expect(canChangeMember(actor, null, "assistant")).toBe(false);
    }
  });

  it("lists assignable roles", () => {
    expect(assignableRoles("owner")).toEqual(["owner", "admin", "instructor", "assistant"]);
    expect(assignableRoles("admin")).toEqual(["admin", "instructor", "assistant"]);
    expect(assignableRoles("instructor")).toEqual([]);
  });
});
