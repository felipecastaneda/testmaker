import { describe, expect, it } from "vitest";
import { courseAccess, isOrgAdmin } from "@/lib/permissions";
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
