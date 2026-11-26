import "server-only";
import { getAccessible, requireEditable } from "./assignments-repo";
import { attemptIdFor, readQuestions } from "./attempts-repo";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { cleanName, gradeAttempt, studentKeyOf } from "@/lib/grading";
import { lettersToAnswers, normalizePaperId, paperVariants, versionLabels, type PaperExam, type PaperLetters } from "@/lib/paper";
import type { PaperOptions, QuestionData } from "@/lib/types";

/*
 * Paper assignments: everything the professor needs to print them, and saving the answers they
 * type (or, from part 2, scan) as ordinary attempts. A paper attempt looks like an online one
 * (answers = question id → option text, graded the same way) plus
 *   source: "paper", variant: "A".."D", entry: "typed" | "scan"
 */

const ATTEMPTS = "attempts";
const NOT_PAPER = "This isn't a paper exam.";

function paperOf(d: FirebaseFirestore.DocumentData | undefined): (PaperOptions & { seed: string }) | null {
  return d?.delivery === "paper" && d.paper ? d.paper : null;
}

/** What printing needs: questions with the key, and the version seed. */
export async function getPaperExam(user: AuthedUser, id: string): Promise<PaperExam> {
  const { ref, snap } = await getAccessible(user, id);
  const paper = paperOf(snap.data());
  if (!paper) throw new UserFacingError(NOT_PAPER);
  const questions: PaperExam["questions"] = [...(await readQuestions(ref)).values()].map((stored) => {
    // Keep `accepted` (regrades) so score previews match the server's grading.
    const q: QuestionData & { position?: number } = { ...stored };
    delete q.position;
    return q;
  });
  return {
    title: snap.get("title"),
    paper: { versions: paper.versions, idLength: paper.idLength, idCharset: paper.idCharset },
    seed: paper.seed,
    questions,
  };
}

export interface PaperAnswersInput {
  studentId: string;
  studentName: string;
  variant: string;
  /** One entry per question on the sheet: option index or null (blank). */
  letters: PaperLetters;
  /** Overwrite an existing attempt for this student ID. */
  replace: boolean;
}

export type SavePaperResult =
  | { saved: true; attemptId: string; earned: number; possible: number }
  | { saved: false; existing: { studentName: string; studentId: string } };

/** Grade one student's sheet and store it as their attempt. */
export async function savePaperAnswers(
  user: AuthedUser,
  id: string,
  input: PaperAnswersInput,
  entry: "typed" | "scan" = "typed"
): Promise<SavePaperResult> {
  const { ref, snap } = await requireEditable(user, id);
  const paper = paperOf(snap.data());
  if (!paper) throw new UserFacingError(NOT_PAPER);

  const normalized = normalizePaperId(input.studentId, paper);
  if ("error" in normalized) throw new UserFacingError(normalized.error);
  const versionIndex = versionLabels(paper.versions).indexOf(input.variant);
  if (versionIndex < 0) throw new UserFacingError(`This exam has versions ${versionLabels(paper.versions).join(", ")}.`);

  const stored = [...(await readQuestions(ref)).values()];
  const variant = paperVariants(stored, paper.versions, paper.seed)[versionIndex];
  if (input.letters.length !== variant.questions.length) throw new UserFacingError("The answers don't match this exam's questions.");
  input.letters.forEach((l, i) => {
    if (l !== null && !(Number.isInteger(l) && l >= 0 && l < variant.questions[i].options.length)) {
      throw new UserFacingError(`Question ${i + 1} has no option ${l}.`);
    }
  });

  const studentId = normalized.id;
  const attemptRef = ref.collection(ATTEMPTS).doc(attemptIdFor(ref.id, studentKeyOf(studentId)));
  const existing = await attemptRef.get();
  if (existing.exists && !input.replace) {
    return { saved: false, existing: { studentName: existing.get("studentName") ?? "", studentId: existing.get("studentId") ?? studentId } };
  }

  const answers = lettersToAnswers(variant, input.letters);
  const grade = gradeAttempt(stored, answers);
  const now = new Date().toISOString();
  // Keep a name typed earlier when this entry has none (e.g. a re-entry by ID only).
  const studentName = cleanName(input.studentName).slice(0, 120) || (existing.get("studentName") as string | undefined) || "";
  await attemptRef.set({
    source: "paper",
    entry,
    variant: input.variant,
    letters: input.letters,
    studentName,
    studentId,
    studentKey: studentKeyOf(studentId),
    startedAt: now,
    submittedAt: now,
    submittedBy: "teacher",
    deadline: null,
    answers,
    grade,
    focusLosses: 0,
    enteredBy: user.uid,
    updatedAt: now,
  });
  return { saved: true, attemptId: attemptRef.id, earned: grade.earned, possible: grade.possible };
}
