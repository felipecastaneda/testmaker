import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import { getAccessible, requireEditable, toSummary } from "./assignments-repo";
import { finishExpiredAttempts, readQuestions } from "./attempts-repo";
import { readClassList } from "./paper-repo";
import { deleteScan } from "./scans-store";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { MAX_TIME_LIMIT_MINUTES } from "@/lib/assignments";
import type { GradebookAttempt, GradebookView } from "@/lib/gradebook";
import { gradeAttempt, type AttemptGrade } from "@/lib/grading";
import { isTrueFalse, pointsOf } from "@/lib/question-utils";
import type { QuestionData } from "@/lib/types";

const ATTEMPTS = "attempts";
const QUESTIONS = "questions";
const ATTEMPT_NOT_FOUND = "That student's attempt no longer exists. Refresh the gradebook.";

const allOptions = (q: QuestionData) => (isTrueFalse(q) ? ["True", "False"] : [q.correctAnswer, ...q.distractors]);

/** Everything a professor needs to grade an assignment. Finishes attempts whose time is up first. */
export async function getGradebook(user: AuthedUser, id: string): Promise<GradebookView> {
  const { ref, canEdit } = await getAccessible(user, id);
  await finishExpiredAttempts(ref);
  const [snap, questions, attempts, classList] = await Promise.all([ref.get(), readQuestions(ref), ref.collection(ATTEMPTS).get(), readClassList(ref)]);
  return {
    classList: snap.get("delivery") === "paper" ? classList : [],
    assignment: toSummary(snap.id, snap.data()!, canEdit, {
      started: attempts.size,
      submitted: attempts.docs.filter((d) => d.get("submittedAt")).length,
    }),
    questions: [...questions.values()].map((q) => ({
      id: q.id,
      question: q.question,
      correctAnswer: q.correctAnswer,
      options: allOptions(q),
      points: pointsOf(q),
      accepted: q.accepted ?? [],
    })),
    attempts: attempts.docs.map(
      (d): GradebookAttempt => ({
        id: d.id,
        studentName: d.get("studentName"),
        studentId: d.get("studentId"),
        status: d.get("submittedAt") ? "submitted" : "in_progress",
        startedAt: d.get("startedAt"),
        submittedAt: d.get("submittedAt") ?? null,
        submittedBy: d.get("submittedBy") ?? null,
        deadline: d.get("deadline") ?? null,
        extended: d.get("extended") === true,
        answers: d.get("answers") ?? {},
        grade: (d.get("grade") as AttemptGrade | undefined) ?? null,
        focusLosses: d.get("focusLosses") ?? 0,
        source: d.get("source") === "paper" ? "paper" : "online",
        variant: d.get("variant") ?? null,
        entry: d.get("entry") ?? null,
        hasScan: !!d.get("scan"),
      })
    ),
  };
}

/** Show (or hide again) results to students, whatever the release rule. */
export async function setResultsReleased(user: AuthedUser, id: string, released: boolean): Promise<void> {
  const { ref } = await requireEditable(user, id);
  await ref.update({ resultsReleased: released, updatedAt: new Date().toISOString() });
}

/**
 * Delete a student's attempt so they can start again (switched device, or someone else
 * used their ID). Their answers and grade are gone; their old link stops working.
 */
export async function resetAttempt(user: AuthedUser, id: string, attemptId: string): Promise<void> {
  const { ref } = await requireEditable(user, id);
  const attemptRef = ref.collection(ATTEMPTS).doc(attemptId);
  if (!(await attemptRef.get()).exists) throw new UserFacingError(ATTEMPT_NOT_FOUND);
  await attemptRef.delete();
  await deleteScan(id, attemptId); // paper attempts may have a scanned sheet
}

/**
 * Give one in-progress student extra minutes (accommodations). The new deadline counts from
 * their current one, or from now if that already passed, and it outlasts the closing time.
 */
export async function extendAttempt(user: AuthedUser, id: string, attemptId: string, minutes: number): Promise<string> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIME_LIMIT_MINUTES) {
    throw new UserFacingError(`Extra time must be between 1 and ${MAX_TIME_LIMIT_MINUTES} minutes.`);
  }
  const { ref, snap } = await requireEditable(user, id);
  if (snap.get("status") === "closed") throw new UserFacingError("Reopen the assignment before giving extra time.");
  const attemptRef = ref.collection(ATTEMPTS).doc(attemptId);
  return adminDb().runTransaction(async (tx) => {
    const attempt = await tx.get(attemptRef);
    if (!attempt.exists) throw new UserFacingError(ATTEMPT_NOT_FOUND);
    if (attempt.get("submittedAt")) throw new UserFacingError("This student has already submitted.");
    const now = Date.now();
    const current = attempt.get("deadline") ?? snap.get("closesAt") ?? null;
    // No time limit and no closing time: there's nothing to extend (and adding one would create a limit).
    if (!current) throw new UserFacingError("This student has no time limit, so there's nothing to extend.");
    const base = Math.max(now, Date.parse(current));
    const deadline = new Date(base + minutes * 60_000).toISOString();
    tx.update(attemptRef, { deadline, extended: true, updatedAt: new Date().toISOString() });
    return deadline;
  });
}

/**
 * Change how one question is graded and recompute every submitted attempt.
 * `accepted`: extra options counted as correct, ["*"] for full credit, [] to undo.
 */
export async function regradeQuestion(user: AuthedUser, id: string, questionId: string, accepted: string[]): Promise<void> {
  const { ref } = await requireEditable(user, id);
  const db = adminDb();
  const questionRef = ref.collection(QUESTIONS).doc(questionId);
  const question = (await questionRef.get()).data() as QuestionData | undefined;
  if (!question) throw new UserFacingError("That question isn't part of this assignment.");
  const options = allOptions(question);
  const clean = accepted.includes("*") ? ["*"] : [...new Set(accepted)].filter((o) => o !== question.correctAnswer);
  if (!clean.every((o) => o === "*" || options.includes(o))) throw new UserFacingError("Only this question's own options can be accepted.");

  await questionRef.update({ accepted: clean });
  await ref.update({
    regrades: FieldValue.arrayUnion({ questionId, accepted: clean, at: new Date().toISOString(), by: user.uid }),
    updatedAt: new Date().toISOString(),
  });

  // Recompute grades with the updated key. In-progress attempts are graded when they finish.
  const questions = [...(await readQuestions(ref)).values()];
  const attempts = await ref.collection(ATTEMPTS).get();
  const writer = db.bulkWriter();
  for (const a of attempts.docs) {
    if (!a.get("submittedAt")) continue;
    writer.update(a.ref, { grade: gradeAttempt(questions, a.get("answers") ?? {}) });
  }
  await writer.close();
}
