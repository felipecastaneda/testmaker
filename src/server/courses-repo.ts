import "server-only";
import { parseDomains } from "@/lib/student-identity";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { getActiveOrgId } from "./members-repo";
import { countTestsInCourse } from "./tests-repo";
import {
  defaultCourseId,
  getOrgDoc,
  getOrgRole,
  listViewableCourses,
  personalOrgId,
  requireCourseAccess,
} from "./workspace";
import { canCreateCourses } from "@/lib/permissions";
import { resolveSetting, type StoredSettings } from "@/lib/settings/resolve";
import type { CourseInput, CourseSummary, CoursesOverview } from "@/lib/types";

const COURSES = "courses";

/** The personal "My tests" course: tests are saved there by default, so it can't be removed. */
function isDefaultCourse(courseId: string, data: FirebaseFirestore.DocumentData | undefined): boolean {
  const owner = data?.createdBy;
  return typeof owner === "string" && courseId === defaultCourseId(owner) && data?.orgId === personalOrgId(owner);
}

function orgSettingsOf(org: FirebaseFirestore.DocumentSnapshot | undefined): StoredSettings | undefined {
  return org?.get("settings") as StoredSettings | undefined;
}

function instructorsCanCreate(org: FirebaseFirestore.DocumentSnapshot | undefined): boolean {
  return resolveSetting("courses.instructorsCanCreate", orgSettingsOf(org)).value;
}

function toSummary(
  id: string,
  data: FirebaseFirestore.DocumentData,
  access: { edit: boolean; manage: boolean },
  org: FirebaseFirestore.DocumentSnapshot | undefined
): CourseSummary {
  const orgSettings = orgSettingsOf(org);
  const courseSettings = data.settings as StoredSettings | undefined;
  const instructions =
    resolveSetting("generation.orgInstructions", orgSettings).value ||
    resolveSetting("generation.courseInstructions", orgSettings, courseSettings).value;
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
    assignmentDefaults: {
      timeLimitMinutes: resolveSetting("assignments.defaultTimeLimit", orgSettings, courseSettings).value || null,
      resultsRelease: resolveSetting("assignments.resultsRelease", orgSettings, courseSettings).value,
      showCorrectAnswers: resolveSetting("assignments.showCorrectAnswers", orgSettings, courseSettings).value,
      deliveryModes: resolveSetting("delivery.modes", orgSettings, courseSettings).value,
      identity: resolveSetting("students.identity", orgSettings, courseSettings).value,
      identityLocked: resolveSetting("students.identity", orgSettings, courseSettings).locked,
      askStudentId: resolveSetting("students.askStudentId", orgSettings, courseSettings).value,
      allowedDomains: parseDomains(resolveSetting("students.allowedDomains", orgSettings).value).domains,
    },
    generation: {
      allowedModels: resolveSetting("generation.allowedModels", orgSettings).value,
      defaultDifficulty: resolveSetting("generation.defaultDifficulty", orgSettings, courseSettings).value,
      hasInstructions: !!instructions,
    },
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
  const { memberships, orgs: orgDocs, courses } = await listViewableCourses(user.uid);

  const orgs = memberships
    .map((m) => ({
      id: m.orgId,
      name: (orgDocs.get(m.orgId)?.get("name") as string | undefined) ?? "Organization",
      kind: m.orgKind,
      role: m.role,
      canCreateCourses: canCreateCourses(m.role, instructorsCanCreate(orgDocs.get(m.orgId))),
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1));

  const summaries = courses
    .map((c) => toSummary(c.doc.id, c.doc.data()!, c.access, orgDocs.get(c.doc.get("orgId"))))
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.localeCompare(b.name)
    );
  return { orgs, courses: summaries, activeOrgId: await getActiveOrgId(user.uid, memberships) };
}

export async function createCourse(user: AuthedUser, orgId: string, input: CourseInput): Promise<CourseSummary> {
  const [role, org] = await Promise.all([getOrgRole(orgId, user.uid), getOrgDoc(orgId)]);
  if (!canCreateCourses(role, instructorsCanCreate(org))) {
    throw new UserFacingError("You can't create courses in this organization.");
  }
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
  return toSummary(ref.id, data, { edit: true, manage: true }, org);
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
  // Assignments hold student attempts and grades; never orphan them.
  const assignments = (await adminDb().collection("assignments").where("courseId", "==", courseId).count().get()).data().count;
  if (assignments > 0) {
    throw new UserFacingError(
      `This course still has ${assignments} assignment${assignments === 1 ? "" : "s"} with student work. Delete them first.`
    );
  }
  await ref.delete();
}
