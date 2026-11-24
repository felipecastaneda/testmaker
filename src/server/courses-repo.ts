import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { countTestsInCourse } from "./tests-repo";
import {
  defaultCourseId,
  getOrgRole,
  listMemberships,
  listViewableCourses,
  personalOrgId,
  requireCourseAccess,
} from "./workspace";
import { canCreateCourses } from "@/lib/permissions";
import type { CourseInput, CourseSummary, CoursesOverview } from "@/lib/types";

const ORGS = "orgs";
const COURSES = "courses";

/** The personal "My tests" course: tests are saved there by default, so it can't be removed. */
function isDefaultCourse(courseId: string, data: FirebaseFirestore.DocumentData | undefined): boolean {
  const owner = data?.createdBy;
  return typeof owner === "string" && courseId === defaultCourseId(owner) && data?.orgId === personalOrgId(owner);
}

function toSummary(
  id: string,
  data: FirebaseFirestore.DocumentData,
  access: { edit: boolean; manage: boolean }
): CourseSummary {
  return {
    id,
    orgId: data.orgId,
    name: data.name,
    code: data.code || undefined,
    term: data.term || undefined,
    archived: data.archived === true,
    isDefault: isDefaultCourse(id, data),
    canEdit: access.edit,
    canManage: access.manage,
  };
}

/** Empty strings clear optional fields. */
function optionalFields(input: Partial<CourseInput>, forCreate: boolean) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  for (const key of ["code", "term"] as const) {
    if (input[key] === undefined) continue;
    if (input[key]) out[key] = input[key];
    else if (!forCreate) out[key] = FieldValue.delete();
  }
  return out;
}

export async function getCoursesOverview(user: AuthedUser): Promise<CoursesOverview> {
  const db = adminDb();
  const memberships = await listMemberships(user.uid);
  const [courses, orgSnaps] = await Promise.all([
    listViewableCourses(user.uid, memberships),
    memberships.length ? db.getAll(...memberships.map((m) => db.collection(ORGS).doc(m.orgId))) : Promise.resolve([]),
  ]);

  const orgs = memberships
    .map((m, i) => ({
      id: m.orgId,
      name: (orgSnaps[i]?.get("name") as string | undefined) ?? "Organization",
      kind: m.orgKind,
      role: m.role,
      canCreateCourses: canCreateCourses(m.role),
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1));

  const summaries = courses
    .map((c) => toSummary(c.doc.id, c.doc.data()!, c.access))
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.localeCompare(b.name)
    );
  return { orgs, courses: summaries };
}

export async function createCourse(user: AuthedUser, orgId: string, input: CourseInput): Promise<CourseSummary> {
  const role = await getOrgRole(orgId, user.uid);
  if (!canCreateCourses(role)) throw new UserFacingError("You can't create courses in this organization.");
  const now = new Date().toISOString();
  const ref = adminDb().collection(COURSES).doc();
  const data = {
    orgId,
    ...optionalFields(input, true),
    archived: false,
    staff: { [user.uid]: "instructor" },
    staffUids: [user.uid],
    settings: { values: {} },
    createdBy: user.uid,
    createdAt: now,
    updatedAt: now,
  };
  await ref.create(data);
  return toSummary(ref.id, data, { edit: true, manage: true });
}

export async function updateCourse(
  user: AuthedUser,
  courseId: string,
  patch: Partial<CourseInput> & { archived?: boolean }
): Promise<void> {
  await requireCourseAccess(user, courseId, "manage");
  const ref = adminDb().collection(COURSES).doc(courseId);
  if (patch.archived && isDefaultCourse(courseId, (await ref.get()).data())) {
    throw new UserFacingError("Your default course can't be archived.");
  }
  await ref.update({
    ...optionalFields(patch, false),
    ...(patch.archived === undefined ? {} : { archived: patch.archived }),
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteCourse(user: AuthedUser, courseId: string): Promise<void> {
  await requireCourseAccess(user, courseId, "manage");
  const ref = adminDb().collection(COURSES).doc(courseId);
  if (isDefaultCourse(courseId, (await ref.get()).data())) {
    throw new UserFacingError("Your default course can't be deleted.");
  }
  const tests = await countTestsInCourse(courseId);
  if (tests > 0) {
    throw new UserFacingError(`This course still has ${tests} test${tests === 1 ? "" : "s"}. Move or delete them first.`);
  }
  await ref.delete();
}
