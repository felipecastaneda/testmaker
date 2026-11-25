import "server-only";
import { randomInt } from "node:crypto";
import { adminDb } from "./admin";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { loadTest } from "./tests-repo";
import { getCourseAccess, listViewableCourses, requireCourseAccess } from "./workspace";
import { availabilityOf, makeJoinCode, validateAssignmentOptions } from "@/lib/assignments";
import { totalPoints } from "@/lib/question-utils";
import type { AssignmentOptions, AssignmentStatus, AssignmentSummary, QuestionData } from "@/lib/types";

/*
 * Data model
 *   assignments/{id}                 options + { orgId, courseId, testId, testVersion, status, joinCode,
 *                                     questionCount, totalPoints, stats, resultsReleased, ... }
 *   assignments/{id}/questions/{qid} frozen copy of the test's questions (incl. the answer key) + position
 *   joinCodes/{code}                 { assignmentId } so students can find an assignment by its code
 *
 * An assignment is a snapshot: editing the test afterwards never changes it.
 */

const ASSIGNMENTS = "assignments";
const QUESTIONS = "questions";
const JOIN_CODES = "joinCodes";
const NOT_FOUND = "Assignment not found.";
const IN_LIMIT = 30;

export function toSummary(id: string, d: FirebaseFirestore.DocumentData, canEdit: boolean): AssignmentSummary {
  return {
    id,
    orgId: d.orgId,
    courseId: d.courseId,
    testId: d.testId,
    testVersion: d.testVersion,
    title: d.title,
    opensAt: d.opensAt ?? null,
    closesAt: d.closesAt ?? null,
    timeLimitMinutes: d.timeLimitMinutes ?? null,
    shuffleQuestions: d.shuffleQuestions === true,
    resultsRelease: d.resultsRelease,
    showCorrectAnswers: d.showCorrectAnswers === true,
    status: d.status,
    availability: availabilityOf({ status: d.status, opensAt: d.opensAt ?? null, closesAt: d.closesAt ?? null }),
    joinCode: d.joinCode,
    questionCount: d.questionCount ?? 0,
    totalPoints: d.totalPoints ?? 0,
    stats: { started: d.stats?.started ?? 0, submitted: d.stats?.submitted ?? 0 },
    resultsReleased: d.resultsReleased === true,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    canEdit,
  };
}

/** Load an assignment the user can see, with whether they may change it. */
export async function getAccessible(user: AuthedUser, id: string) {
  if (!id || id.includes("/")) throw new UserFacingError(NOT_FOUND);
  const ref = adminDb().collection(ASSIGNMENTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new UserFacingError(NOT_FOUND);
  // Same message for "missing" and "not yours" so ids can't be probed.
  const course = await getCourseAccess(user, snap.get("courseId"));
  if (!course) throw new UserFacingError(NOT_FOUND);
  return { ref, snap, canEdit: course.access.edit };
}

export async function requireEditable(user: AuthedUser, id: string) {
  const found = await getAccessible(user, id);
  if (!found.canEdit) throw new UserFacingError("You can view this assignment but not change it.");
  return found;
}

function checkOptions(options: Pick<AssignmentOptions, "opensAt" | "closesAt" | "timeLimitMinutes">) {
  const problem = validateAssignmentOptions(options);
  if (problem) throw new UserFacingError(problem);
}

export async function createAssignment(
  user: AuthedUser,
  testId: string,
  options: AssignmentOptions,
  open: boolean
): Promise<string> {
  const test = await loadTest(user, testId);
  const { orgId } = await requireCourseAccess(user, test.courseId, "edit", "Test not found.");
  if (test.questions.length === 0) throw new UserFacingError("This test has no questions yet.");
  checkOptions(options);

  const db = adminDb();
  const ref = db.collection(ASSIGNMENTS).doc();
  const now = new Date().toISOString();

  // Frozen copy of the questions first; nothing points at it until the assignment exists.
  const writer = db.bulkWriter();
  test.questions.forEach((q: QuestionData, position) => writer.set(ref.collection(QUESTIONS).doc(q.id), { ...q, position }));
  await writer.close();

  const status: AssignmentStatus = open ? "open" : "draft";
  for (let attempt = 0; ; attempt++) {
    const joinCode = makeJoinCode((n) => randomInt(n));
    const batch = db.batch();
    // create() fails if the code is taken, which fails the whole batch.
    batch.create(db.collection(JOIN_CODES).doc(joinCode), { assignmentId: ref.id, createdAt: now });
    batch.create(ref, {
      ...options,
      orgId,
      courseId: test.courseId,
      testId: test.id,
      testVersion: test.version,
      status,
      joinCode,
      questionCount: test.questions.length,
      totalPoints: totalPoints(test.questions),
      stats: { started: 0, submitted: 0 },
      resultsReleased: false,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await batch.commit();
      return ref.id;
    } catch (error) {
      const taken = (error as { code?: number }).code === 6; // ALREADY_EXISTS
      if (!taken || attempt >= 4) {
        await db.recursiveDelete(ref);
        throw error;
      }
    }
  }
}

export async function listAssignments(user: AuthedUser, courseId?: string): Promise<AssignmentSummary[]> {
  const { courses } = await listViewableCourses(user.uid);
  const editable = new Map(courses.map((c) => [c.doc.id, c.access.edit]));
  const ids = courseId ? (editable.has(courseId) ? [courseId] : []) : [...editable.keys()];
  const snaps = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / IN_LIMIT) }, (_, i) =>
      adminDb().collection(ASSIGNMENTS).where("courseId", "in", ids.slice(i * IN_LIMIT, (i + 1) * IN_LIMIT)).get()
    )
  );
  return snaps
    .flatMap((s) => s.docs)
    .map((d) => toSummary(d.id, d.data(), editable.get(d.get("courseId")) ?? false))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAssignment(user: AuthedUser, id: string): Promise<AssignmentSummary> {
  const { snap, canEdit } = await getAccessible(user, id);
  return toSummary(snap.id, snap.data()!, canEdit);
}

export async function updateAssignment(
  user: AuthedUser,
  id: string,
  patch: Partial<AssignmentOptions> & { status?: AssignmentStatus }
): Promise<AssignmentSummary> {
  const { ref, snap } = await requireEditable(user, id);
  const current = snap.data()!;
  const merged = {
    opensAt: patch.opensAt !== undefined ? patch.opensAt : current.opensAt ?? null,
    closesAt: patch.closesAt !== undefined ? patch.closesAt : current.closesAt ?? null,
    timeLimitMinutes: patch.timeLimitMinutes !== undefined ? patch.timeLimitMinutes : current.timeLimitMinutes ?? null,
  };
  checkOptions(merged);
  const update = { ...patch, updatedAt: new Date().toISOString() };
  await ref.update(update);
  return toSummary(id, { ...current, ...update }, true);
}

/** Deletes the assignment with all its questions and every student attempt. */
export async function deleteAssignment(user: AuthedUser, id: string): Promise<void> {
  const { ref, snap } = await requireEditable(user, id);
  const db = adminDb();
  await db.recursiveDelete(ref);
  await db.collection(JOIN_CODES).doc(snap.get("joinCode")).delete();
}
