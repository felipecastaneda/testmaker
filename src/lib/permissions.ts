import type { CourseAccessNeed, CourseRole, OrgRole } from "./types";

/**
 * Who may do what. Pure functions so the same rules can drive the server checks
 * and (later) which buttons the UI shows. See docs/plans/step-1-foundation.md.
 */

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "instructor", "assistant"];

export function isOrgAdmin(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export interface CourseAccessInput {
  /** The user's role in the course's organization; null when not a member. */
  orgRole: OrgRole | null;
  /** The user's role on the course's staff; null when not on it. */
  courseRole: CourseRole | null;
  /** Course setting `assistants.canEdit`. */
  assistantsCanEdit: boolean;
}

export function courseAccess({ orgRole, courseRole, assistantsCanEdit }: CourseAccessInput): Record<CourseAccessNeed, boolean> {
  // Course staff lose access as soon as they leave the organization.
  if (!orgRole) return { view: false, edit: false, manage: false };
  if (isOrgAdmin(orgRole) || courseRole === "instructor") return { view: true, edit: true, manage: true };
  if (courseRole === "assistant") return { view: true, edit: assistantsCanEdit, manage: false };
  return { view: false, edit: false, manage: false };
}

export function canAccessCourse(input: CourseAccessInput, need: CourseAccessNeed): boolean {
  return courseAccess(input)[need];
}

/** Org setting `courses.instructorsCanCreate` defaults to true until settings ship. */
export function canCreateCourses(role: OrgRole | null | undefined, instructorsCanCreate = true): boolean {
  return isOrgAdmin(role) || (role === "instructor" && instructorsCanCreate);
}

/**
 * May `actor` give `target` (currently `current`, or null for a new member) the role
 * `next` (or remove them, when `next` is null)? Owners can do anything; admins can't
 * create, change or remove owners; everyone else manages no one.
 * Keeping at least one owner is checked separately, since it needs the member count.
 */
export function canChangeMember(actor: OrgRole | null, current: OrgRole | null, next: OrgRole | null): boolean {
  if (actor === "owner") return true;
  if (actor !== "admin") return false;
  return current !== "owner" && next !== "owner";
}

/** Roles `actor` may hand out in an invite or role change. */
export function assignableRoles(actor: OrgRole | null): OrgRole[] {
  return ORG_ROLES.filter((r) => canChangeMember(actor, null, r));
}
