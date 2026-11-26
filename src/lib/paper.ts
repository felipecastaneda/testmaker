import { buildVariants, type TestVariant } from "./exporters";
import { isTrueFalse, optionLetter } from "./question-utils";
import type { PaperIdCharset, PaperOptions, QuestionData } from "./types";

/**
 * Paper exams: versions, limits and typed answers. Shared by the browser (printing,
 * previews) and the server (grading), so both always agree on what "B, question 3, C" means.
 */

export const PAPER_MAX_VERSIONS = 4;
export const PAPER_MAX_OPTIONS = 5;
export const PAPER_ID_MIN = 4;
export const PAPER_ID_MAX = 12;
export const PAPER_DEFAULTS: PaperOptions = { versions: 2, idLength: 8, idCharset: "letters_digits" };

export const ID_CHARSETS: Record<PaperIdCharset, string> = {
  letters_digits: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  digits: "0123456789",
};

/** How many questions fit on one answer sheet (the letters grid takes more room). */
export function paperMaxQuestions(charset: PaperIdCharset): number {
  return charset === "digits" ? 100 : 75;
}

export const versionLabels = (count: number) => Array.from({ length: count }, (_, i) => optionLetter(i));

export const optionCount = (q: QuestionData) => (isTrueFalse(q) ? 2 : 1 + q.distractors.length);

/** Why these questions can't go on an answer sheet, or null when they can. */
export function paperProblem(questions: QuestionData[], charset: PaperIdCharset): string | null {
  const max = paperMaxQuestions(charset);
  if (questions.length > max) {
    return `An answer sheet holds at most ${max} questions${charset === "digits" ? "" : " (100 with digits-only student IDs)"}. This test has ${questions.length}.`;
  }
  const tooMany = questions.findIndex((q) => optionCount(q) > PAPER_MAX_OPTIONS);
  if (tooMany >= 0) {
    return `Question ${tooMany + 1} has ${optionCount(questions[tooMany])} options; answer sheets allow at most ${PAPER_MAX_OPTIONS} (A–E).`;
  }
  // The key must be one of the printed options, or no bubble could ever be right.
  const noKey = questions.findIndex((q) => (isTrueFalse(q) ? !["True", "False"].includes(q.correctAnswer) : !q.correctAnswer.trim()));
  if (noKey >= 0) return `Question ${noKey + 1}'s correct answer isn't one of its options. Fix it in the test first.`;
  return null;
}

/**
 * The printed versions of a paper assignment. `questions` must be in assignment order.
 * Version A keeps that order; every version shuffles options, seeded per assignment so a
 * reprint is identical and another assignment of the same test gets different versions.
 */
export function paperVariants(questions: QuestionData[], versions: number, seed: string): TestVariant[] {
  return buildVariants(questions, versions, `paper:${seed}`);
}

/** Upper-case, no spaces. Returns an error message for characters the sheet can't hold. */
export function normalizePaperId(raw: string, options: Pick<PaperOptions, "idLength" | "idCharset">): { id: string } | { error: string } {
  const id = raw.replace(/\s+/g, "").toUpperCase();
  if (!id) return { error: "Enter the student ID." };
  if (id.length > options.idLength) return { error: `Student IDs on this exam have at most ${options.idLength} characters.` };
  const allowed = ID_CHARSETS[options.idCharset];
  if ([...id].some((c) => !allowed.includes(c))) {
    return { error: options.idCharset === "digits" ? "This exam's student IDs are digits only." : "Student IDs can only use letters A–Z and digits." };
  }
  return { id };
}

/** One answer per question: an option index, or null for blank. */
export type PaperLetters = (number | null)[];

/**
 * Parse typed answers like "ABDCA -BC" (spaces ignored; "-", "." or "_" = blank).
 * Fewer answers than questions leaves the rest blank.
 */
export function parseTypedAnswers(text: string, variant: TestVariant): { letters: PaperLetters } | { error: string } {
  const chars = [...text.toUpperCase().replace(/\s+/g, "")];
  if (chars.length > variant.questions.length) {
    return { error: `That's ${chars.length} answers; this exam has ${variant.questions.length} questions.` };
  }
  const letters: PaperLetters = [];
  for (let i = 0; i < variant.questions.length; i++) {
    const c = chars[i];
    if (c === undefined || c === "-" || c === "." || c === "_") {
      letters.push(null);
      continue;
    }
    const index = c.charCodeAt(0) - 65;
    const count = variant.questions[i].options.length;
    if (index < 0 || index >= count) {
      return { error: `Question ${i + 1}: "${c}" isn't an option (use ${optionLetter(0)}–${optionLetter(count - 1)}, or - for blank).` };
    }
    letters.push(index);
  }
  return { letters };
}

/** Turn sheet positions into the stored form (question id → option text), as online attempts store it. */
export function lettersToAnswers(variant: TestVariant, letters: PaperLetters): Record<string, string> {
  const answers: Record<string, string> = {};
  variant.questions.forEach(({ question, options }, i) => {
    const index = letters[i];
    if (index !== null && index !== undefined && options[index] !== undefined) answers[question.id] = options[index];
  });
  return answers;
}

/** "AB-D…" from stored letters (for display). */
export const lettersToText = (letters: PaperLetters) => letters.map((l) => (l === null ? "-" : optionLetter(l))).join("");

/** A paper exam as a professor's browser gets it, for printing and previews. */
export interface PaperExam {
  title: string;
  paper: PaperOptions;
  /** Seeds the printed versions; the same seed always gives the same versions. */
  seed: string;
  /** In assignment order, with the answer key (professors only). */
  questions: (QuestionData & { accepted?: string[] })[];
}
