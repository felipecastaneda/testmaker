import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldPath, FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import { UserFacingError } from "./errors";
import { attemptIsOver, availabilityOf, DEFAULT_MAX_STUDENTS, isValidJoinCode, normalizeJoinCode } from "@/lib/assignments";
import type { JoinResult, PublicAssignmentInfo, StudentExamView } from "@/lib/exam-types";
import { attemptDeadline, cleanName, gradeAttempt, studentKeyOf, studentResult, type AttemptGrade } from "@/lib/grading";
import { orderOptions } from "@/lib/question-utils";
import { toStudentQuestion } from "@/lib/student-view";
import type { AssignmentStatus, QuestionData } from "@/lib/types";
import { seededShuffle } from "@/lib/utils";

/*
 * Data model
 *   assignments/{id}/attempts/{attemptId}
 *     tokenHash, studentName, studentId, studentKey, startedAt, deadline, order, answers,
 *     submittedAt?, submittedBy?, grade?, focusLosses, userAgent, updatedAt
 *
 * attemptId = sha256(assignmentId + studentKey): one attempt per student ID, enforced by
 * create(). Students have no account: their browser holds "<assignmentId>.<attemptId>.<secret>"
 * and we store only sha256(secret).
 */

const ASSIGNMENTS = "assignments";
const ATTEMPTS = "attempts";
const QUESTIONS = "questions";
const JOIN_CODES = "joinCodes";
/** Abuse guard: no class is this big. */
const MAX_ATTEMPTS_PER_ASSIGNMENT = 2_000;
const ID = /^[A-Za-z0-9_-]{1,200}$/;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** One attempt per student ID: the attempt's id is derived from it (online and paper alike). */
export const attemptIdFor = (assignmentId: string, studentKey: string) => sha256(`${assignmentId}:${studentKey}`).slice(0, 40);

export type StoredQuestion = QuestionData & { position: number; accepted?: string[] };

const NOT_AVAILABLE: Record<string, string> = {
  draft: "This exam isn't open yet. Check with your professor.",
  scheduled: "This exam isn't open yet.",
  closed: "This exam is closed.",
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

async function findByCode(rawCode: string) {
  const code = normalizeJoinCode(rawCode);
  if (!isValidJoinCode(code)) throw new UserFacingError("That code doesn't look right. Codes have 8 letters and numbers.");
  const db = adminDb();
  const codeSnap = await db.collection(JOIN_CODES).doc(code).get();
  const assignmentId = codeSnap.get("assignmentId") as string | undefined;
  const snap = assignmentId ? await db.collection(ASSIGNMENTS).doc(assignmentId).get() : null;
  if (!snap?.exists) throw new UserFacingError("There's no exam with that code. Check it with your professor.");
  return snap;
}

function availability(d: FirebaseFirestore.DocumentData) {
  return availabilityOf({ status: d.status, opensAt: d.opensAt ?? null, closesAt: d.closesAt ?? null });
}

export async function getPublicInfo(code: string): Promise<PublicAssignmentInfo> {
  const d = (await findByCode(code)).data()!;
  return {
    title: d.title,
    questionCount: d.questionCount,
    totalPoints: d.totalPoints,
    timeLimitMinutes: d.timeLimitMinutes ?? null,
    availability: availability(d),
    opensAt: d.opensAt ?? null,
    closesAt: d.closesAt ?? null,
  };
}

export async function readQuestions(assignment: DocumentReference): Promise<Map<string, StoredQuestion>> {
  const snap = await assignment.collection(QUESTIONS).orderBy("position").get();
  return new Map(snap.docs.map((d) => [d.id, d.data() as StoredQuestion]));
}

interface AttemptContext {
  assignmentRef: DocumentReference;
  attemptRef: DocumentReference;
  assignment: FirebaseFirestore.DocumentData;
  attempt: FirebaseFirestore.DocumentData;
}

/** Resolve a student's token to their attempt. Any mismatch looks the same. */
async function loadAttempt(token: string): Promise<AttemptContext> {
  const invalid = () => new UserFacingError("This exam session isn't valid any more. Open the exam link again.");
  const [assignmentId, attemptId, secret] = token.split(".");
  if (!assignmentId || !attemptId || !secret || !ID.test(assignmentId) || !ID.test(attemptId) || secret.length < 20) throw invalid();
  const assignmentRef = adminDb().collection(ASSIGNMENTS).doc(assignmentId);
  const attemptRef = assignmentRef.collection(ATTEMPTS).doc(attemptId);
  const [assignmentSnap, attemptSnap] = await adminDb().getAll(assignmentRef, attemptRef);
  if (!assignmentSnap.exists || !attemptSnap.exists) throw invalid();
  const expected = Buffer.from(attemptSnap.get("tokenHash") as string, "hex");
  const actual = Buffer.from(sha256(secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid();
  return { assignmentRef, attemptRef, assignment: assignmentSnap.data()!, attempt: attemptSnap.data()! };
}

// ---------------------------------------------------------------------------
// Grading and finishing
// ---------------------------------------------------------------------------

/** Submit (grade and lock) an attempt. Idempotent: a second call changes nothing. */
async function finish(ctx: AttemptContext, by: "student" | "deadline" | "teacher"): Promise<void> {
  const questions = [...(await readQuestions(ctx.assignmentRef)).values()];
  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ctx.attemptRef);
    if (fresh.get("submittedAt")) return;
    const grade = gradeAttempt(questions, fresh.get("answers") ?? {});
    // Only the student's own document: a class submitting together never contends.
    tx.update(ctx.attemptRef, { submittedAt: new Date().toISOString(), submittedBy: by, grade, updatedAt: new Date().toISOString() });
  });
}

/** Time is up, or the professor closed the exam: lock in what was saved. */
/**
 * Is this attempt over? Its own deadline passed, the professor closed the exam, or the
 * window closed. Extra time from the professor outlasts the window, but not "Close now".
 */
function isOver(ctx: AttemptContext, now = Date.now()): boolean {
  return attemptIsOver(ctx.assignment as { status: AssignmentStatus }, ctx.attempt, now);
}

/** Submit every attempt whose time is up (professors see final grades without waiting for students). */
export async function finishExpiredAttempts(assignmentRef: DocumentReference): Promise<number> {
  const [assignmentSnap, attempts] = await Promise.all([assignmentRef.get(), assignmentRef.collection(ATTEMPTS).get()]);
  const assignment = assignmentSnap.data();
  if (!assignment) return 0;
  const expired = attempts.docs.filter((a) => !a.get("submittedAt") && attemptIsOver(assignment as { status: AssignmentStatus }, a.data()));
  for (const a of expired) await finish({ assignmentRef, attemptRef: a.ref, assignment, attempt: a.data() }, "deadline");
  return expired.length;
}

async function finishIfOver(ctx: AttemptContext): Promise<AttemptContext> {
  if (ctx.attempt.submittedAt || !isOver(ctx)) return ctx;
  await finish(ctx, "deadline");
  return { ...ctx, attempt: (await ctx.attemptRef.get()).data()! };
}

// ---------------------------------------------------------------------------
// The student's view
// ---------------------------------------------------------------------------

async function buildView(ctx: AttemptContext): Promise<StudentExamView> {
  const questions = await readQuestions(ctx.assignmentRef);
  const attemptId = ctx.attemptRef.id;
  const ordered = (ctx.attempt.order as string[]).map((id) => questions.get(id)).filter((q): q is StoredQuestion => !!q);
  const answers = (ctx.attempt.answers ?? {}) as Record<string, string>;
  const view: StudentExamView = {
    title: ctx.assignment.title,
    studentName: ctx.attempt.studentName,
    status: ctx.attempt.submittedAt ? "submitted" : "in_progress",
    deadline: ctx.attempt.deadline ?? null,
    serverNow: new Date().toISOString(),
    questions: ordered.map((q) => toStudentQuestion(q, attemptId)),
    answers,
    totalPoints: ctx.assignment.totalPoints,
  };
  if (ctx.attempt.submittedAt) {
    view.submittedAt = ctx.attempt.submittedAt;
    view.submittedBy = ctx.attempt.submittedBy;
    const grade = (ctx.attempt.grade as AttemptGrade | undefined) ?? gradeAttempt(ordered, answers);
    view.result = studentResult(
      {
        resultsRelease: ctx.assignment.resultsRelease,
        resultsReleased: ctx.assignment.resultsReleased === true,
        showCorrectAnswers: ctx.assignment.showCorrectAnswers === true,
      },
      availability(ctx.assignment),
      ordered,
      answers,
      grade
    );
  }
  return view;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function joinAssignment(code: string, rawName: string, rawStudentId: string, userAgent: string): Promise<JoinResult> {
  const snap = await findByCode(code);
  const d = snap.data()!;
  const now = availability(d);
  if (now !== "open") throw new UserFacingError(NOT_AVAILABLE[now]);

  const studentName = cleanName(rawName);
  const studentId = cleanName(rawStudentId);
  const studentKey = studentKeyOf(studentId);
  if (!studentName || studentName.length > 80) throw new UserFacingError("Please enter your full name (up to 80 characters).");
  if (!studentKey || studentId.length > 40) throw new UserFacingError("Please enter your student ID (up to 40 characters).");

  const assignmentRef = snap.ref;
  const attemptRef = assignmentRef.collection(ATTEMPTS).doc(attemptIdFor(snap.id, studentKey));
  const questionIds = [...(await readQuestions(assignmentRef)).keys()];
  const order = d.shuffleQuestions ? seededShuffle(questionIds, attemptRef.id) : questionIds;
  const secret = randomBytes(32).toString("base64url");
  const startedAt = new Date();

  // The professor's student limit. A count, not a shared counter, so a whole class joining
  // at once never queues on one document (approximate under a burst; it's an abuse guard).
  const limit = Math.min(d.maxStudents ?? DEFAULT_MAX_STUDENTS, MAX_ATTEMPTS_PER_ASSIGNMENT);
  if ((await assignmentRef.collection(ATTEMPTS).count().get()).data().count >= limit) {
    throw new UserFacingError("This exam has reached its student limit. Ask your professor.");
  }

  try {
    // create() fails if this student ID already has an attempt: one attempt per ID, no lock.
    await attemptRef.create({
      tokenHash: sha256(secret),
      studentName,
      studentId,
      studentKey,
      startedAt: startedAt.toISOString(),
      deadline: attemptDeadline(startedAt, d.closesAt ?? null, d.timeLimitMinutes ?? null),
      order,
      answers: {},
      focusLosses: 0,
      userAgent: userAgent.slice(0, 200),
      updatedAt: startedAt.toISOString(),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 6) {
      throw new UserFacingError(
        "An attempt with this student ID has already started. Continue on the device where you started, or ask your professor for help."
      );
    }
    throw error;
  }

  const token = `${snap.id}.${attemptRef.id}.${secret}`;
  return { token, view: await getExamView(token) };
}

export async function getExamView(token: string): Promise<StudentExamView> {
  return buildView(await finishIfOver(await loadAttempt(token)));
}

/** Save (or with `option` null, clear) one answer. Refused once the attempt is over. */
export async function saveAnswer(token: string, questionId: string, option: string | null): Promise<void> {
  const ctx = await finishIfOver(await loadAttempt(token));
  if (ctx.attempt.submittedAt) throw new UserFacingError("This exam has already been submitted.");
  if (!(ctx.attempt.order as string[]).includes(questionId)) throw new UserFacingError("That question isn't part of this exam.");
  if (option !== null) {
    const q = (await ctx.assignmentRef.collection(QUESTIONS).doc(questionId).get()).data() as StoredQuestion | undefined;
    if (!q || !orderOptions(q, ctx.attemptRef.id).includes(option)) throw new UserFacingError("That answer isn't one of the options.");
  }
  await ctx.attemptRef.update(
    new FieldPath("answers", questionId),
    option === null ? FieldValue.delete() : option,
    "updatedAt",
    new Date().toISOString()
  );
}

export async function submitAttempt(token: string): Promise<StudentExamView> {
  const ctx = await loadAttempt(token);
  if (!ctx.attempt.submittedAt) await finish(ctx, isOver(ctx) ? "deadline" : "student");
  return getExamView(token);
}

/**
 * Count a time the student left the exam page (switched tab/app, minimized). Shown to the
 * professor as information only: it can't prove or prevent cheating.
 */
export async function recordFocusLoss(token: string): Promise<void> {
  const ctx = await loadAttempt(token);
  if (ctx.attempt.submittedAt) return;
  await ctx.attemptRef.update({ focusLosses: FieldValue.increment(1), updatedAt: new Date().toISOString() });
}
