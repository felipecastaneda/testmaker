import "server-only";
import { adminDb } from "./admin";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { canAccessCourse, courseAccess, isOrgAdmin } from "@/lib/permissions";
import type { CourseAccessNeed, CourseRole, OrgKind, OrgRole } from "@/lib/types";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { resolveSetting, type StoredSettings } from "@/lib/settings/resolve";

/*
 * Data model
 *   users/{uid}                    { email, personalOrgId, defaultOrgId, defaultCourseId, workspaceVersion }
 *   orgs/{orgId}                   { name, kind, createdBy, createdAt, updatedAt, settings }
 *   orgs/{orgId}/members/{uid}     { uid, email, orgId, orgKind, role, joinedAt }
 *   courses/{courseId}             { orgId, name, archived, staff: {uid: role}, staffUids, settings, ... }
 *
 * Every user gets a personal org (one owner) with a default course on first sign-in.
 * Personal ids are derived from the uid, so concurrent first requests can't create
 * duplicates.
 */

const USERS = "users";
const ORGS = "orgs";
const MEMBERS = "members";
const COURSES = "courses";
const TESTS = "tests";
const WORKSPACE_VERSION = 1;

export const personalOrgId = (uid: string) => `p_${uid}`;
export const defaultCourseId = (uid: string) => `p_${uid}_default`;

export interface Workspace {
  personalOrgId: string;
  defaultCourseId: string;
}

export interface Membership {
  orgId: string;
  orgKind: OrgKind;
  role: OrgRole;
}

/**
 * Make sure the user has a profile, a personal org and a default course, and move any
 * tests they own that predate organizations into that course. Idempotent, and a single
 * read once done.
 */
export async function ensureUserWorkspace(user: AuthedUser): Promise<Workspace> {
  const db = adminDb();
  const userRef = db.collection(USERS).doc(user.uid);
  const snap = await userRef.get();
  if (snap.get("workspaceVersion") === WORKSPACE_VERSION) {
    return { personalOrgId: snap.get("personalOrgId"), defaultCourseId: snap.get("defaultCourseId") };
  }

  const orgId = personalOrgId(user.uid);
  const courseId = defaultCourseId(user.uid);
  const orgRef = db.collection(ORGS).doc(orgId);
  const memberRef = orgRef.collection(MEMBERS).doc(user.uid);
  const courseRef = db.collection(COURSES).doc(courseId);
  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const [org, member, course] = await tx.getAll(orgRef, memberRef, courseRef);
    if (!org.exists) {
      tx.create(orgRef, {
        name: "My workspace",
        kind: "personal",
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
        settings: { values: {}, locked: [] },
      });
    }
    if (!member.exists) {
      tx.create(memberRef, { uid: user.uid, email: user.email, orgId, orgKind: "personal", role: "owner", joinedAt: now });
    }
    if (!course.exists) {
      tx.create(courseRef, {
        orgId,
        name: "My tests",
        archived: false,
        staff: { [user.uid]: "instructor" },
        staffUids: [user.uid],
        settings: { values: {} },
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  await adoptOrphanTests(user.uid, orgId, courseId);

  // Written last: if anything above fails, the next request simply retries.
  await userRef.set(
    {
      email: user.email,
      createdAt: snap.get("createdAt") ?? now,
      updatedAt: now,
      personalOrgId: orgId,
      defaultOrgId: snap.get("defaultOrgId") ?? orgId,
      defaultCourseId: courseId,
      workspaceVersion: WORKSPACE_VERSION,
    },
    { merge: true }
  );
  return { personalOrgId: orgId, defaultCourseId: courseId };
}

/** Put tests the user owns that aren't in any course into `courseId`. Returns how many moved. */
export async function adoptOrphanTests(uid: string, orgId: string, courseId: string): Promise<number> {
  const db = adminDb();
  const owned = await db.collection(TESTS).where("ownerId", "==", uid).get();
  const orphans = owned.docs.filter((d) => !d.get("courseId"));
  if (orphans.length === 0) return 0;
  const writer = db.bulkWriter();
  for (const doc of orphans) writer.update(doc.ref, { orgId, courseId });
  await writer.close();
  return orphans.length;
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export async function listMemberships(uid: string): Promise<Membership[]> {
  const snap = await adminDb().collectionGroup(MEMBERS).where("uid", "==", uid).get();
  return snap.docs.map((d) => ({ orgId: d.get("orgId"), orgKind: d.get("orgKind"), role: d.get("role") }));
}

/** Being a member of an institution grants access even without being on the allow-list. */
export async function hasInstitutionMembership(uid: string): Promise<boolean> {
  return (await listMemberships(uid)).some((m) => m.orgKind === "institution");
}

export async function getOrgRole(orgId: string, uid: string): Promise<OrgRole | null> {
  const snap = await adminDb().collection(ORGS).doc(orgId).collection(MEMBERS).doc(uid).get();
  return snap.exists ? (snap.get("role") as OrgRole) : null;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export async function getOrgDoc(orgId: string): Promise<DocumentSnapshot> {
  return adminDb().collection(ORGS).doc(orgId).get();
}

/** The course setting `assistants.canEdit`, honouring org locks. */
function assistantsCanEdit(org: DocumentSnapshot | undefined, course: FirebaseFirestore.DocumentData | undefined): boolean {
  return resolveSetting("assistants.canEdit", org?.get("settings") as StoredSettings | undefined, course?.settings).value;
}

export function courseRoleOf(data: FirebaseFirestore.DocumentData | undefined, uid: string): CourseRole | null {
  const role = data?.staff?.[uid];
  return role === "instructor" || role === "assistant" ? role : null;
}

/**
 * Throw `notFound` unless the user may `need` the course. Missing and forbidden look
 * the same, so ids can't be probed.
 */
export async function requireCourseAccess(
  user: AuthedUser,
  courseId: unknown,
  need: CourseAccessNeed,
  notFound = "Course not found."
): Promise<{ courseId: string; orgId: string; archived: boolean }> {
  if (typeof courseId !== "string" || !courseId || courseId.includes("/")) throw new UserFacingError(notFound);
  const snap = await adminDb().collection(COURSES).doc(courseId).get();
  if (!snap.exists) throw new UserFacingError(notFound);
  const orgId: string = snap.get("orgId");
  const orgRole = await getOrgRole(orgId, user.uid);
  const courseRole = courseRoleOf(snap.data(), user.uid);
  // Only an assistant's edit rights depend on settings; skip the org read otherwise.
  const needsSettings = need === "edit" && courseRole === "assistant" && !isOrgAdmin(orgRole);
  const allowed = canAccessCourse(
    {
      orgRole,
      courseRole,
      assistantsCanEdit: needsSettings ? assistantsCanEdit(await getOrgDoc(orgId), snap.data()) : false,
    },
    need
  );
  if (!allowed) throw new UserFacingError(notFound);
  return { courseId, orgId, archived: snap.get("archived") === true };
}

export interface ViewableCourse {
  doc: DocumentSnapshot;
  orgRole: OrgRole;
  courseRole: CourseRole | null;
  access: Record<CourseAccessNeed, boolean>;
}

export interface ViewableCourses {
  memberships: Membership[];
  /** The documents of every org the user belongs to, by id. */
  orgs: Map<string, DocumentSnapshot>;
  courses: ViewableCourse[];
}

/** Every course the user can view, across all their orgs, with what they may do in it. */
export async function listViewableCourses(uid: string): Promise<ViewableCourses> {
  const db = adminDb();
  const memberships = await listMemberships(uid);
  const roleByOrg = new Map(memberships.map((m) => [m.orgId, m.role]));

  const adminOrgs = memberships.filter((m) => isOrgAdmin(m.role)).map((m) => m.orgId);
  const [adminCourses, staffCourses, orgSnaps] = await Promise.all([
    Promise.all(adminOrgs.map((orgId) => db.collection(COURSES).where("orgId", "==", orgId).get())),
    db.collection(COURSES).where("staffUids", "array-contains", uid).get(),
    memberships.length ? db.getAll(...memberships.map((m) => db.collection(ORGS).doc(m.orgId))) : Promise.resolve([]),
  ]);
  const orgs = new Map(orgSnaps.map((o) => [o.id, o]));

  const byId = new Map<string, ViewableCourse>();
  for (const doc of [...adminCourses.flatMap((s) => s.docs), ...staffCourses.docs]) {
    const orgRole = roleByOrg.get(doc.get("orgId")) ?? null;
    const courseRole = courseRoleOf(doc.data(), uid);
    const access = courseAccess({
      orgRole,
      courseRole,
      assistantsCanEdit: assistantsCanEdit(orgs.get(doc.get("orgId")), doc.data()),
    });
    if (orgRole && access.view) byId.set(doc.id, { doc, orgRole, courseRole, access });
  }
  return { memberships, orgs, courses: [...byId.values()] };
}

/** Ids of every course the user can view, across all their orgs. */
export async function listViewableCourseIds(uid: string): Promise<string[]> {
  return (await listViewableCourses(uid)).courses.map((c) => c.doc.id);
}
