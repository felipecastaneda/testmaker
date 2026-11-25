import { pointsOf } from "./question-utils";
import type { AssignmentAvailability, QuestionData, ResultsRelease } from "./types";

export interface QuestionGrade {
  correct: boolean;
  /** Points earned for this question (0 or its full value; partial credit comes later). */
  points: number;
}

export interface AttemptGrade {
  earned: number;
  possible: number;
  perQuestion: Record<string, QuestionGrade>;
}

/**
 * Grade answers against the answer key. `answers` maps question id → chosen option text.
 * `accepted` (from a regrade) can list extra correct options, or "*" for full credit.
 */
export function gradeAttempt(
  questions: (QuestionData & { accepted?: string[] })[],
  answers: Record<string, string | undefined>
): AttemptGrade {
  const perQuestion: Record<string, QuestionGrade> = {};
  let earned = 0;
  let possible = 0;
  for (const q of questions) {
    const value = pointsOf(q);
    const answer = answers[q.id];
    const accepted = q.accepted ?? [];
    const correct = accepted.includes("*") || (answer !== undefined && (answer === q.correctAnswer || accepted.includes(answer)));
    const points = correct ? value : 0;
    perQuestion[q.id] = { correct, points };
    earned += points;
    possible += value;
  }
  return { earned, possible, perQuestion };
}

export function percentage(earned: number, possible: number): number {
  return possible === 0 ? 0 : Math.round((earned / possible) * 100);
}

/** Whether students may see their results right now. */
export function resultsVisible(
  a: { resultsRelease: ResultsRelease; resultsReleased: boolean },
  availability: AssignmentAvailability
): boolean {
  if (a.resultsRelease === "immediately") return true;
  if (a.resultsRelease === "after_close") return availability === "closed" || a.resultsReleased;
  return a.resultsReleased;
}

export type StudentResult =
  | { released: false; message: string }
  | {
      released: true;
      earned: number;
      possible: number;
      percentage: number;
      questions: {
        id: string;
        question: string;
        points: number;
        earned: number;
        correct: boolean;
        yourAnswer: string | null;
        /** Only when the assignment shows correct answers. */
        correctAnswer?: string;
        explanation?: string;
      }[];
    };

/**
 * What a student may see after submitting, given the assignment's rules. Never includes
 * correct answers or explanations unless results are released AND showCorrectAnswers is on.
 */
export function studentResult(
  a: { resultsRelease: ResultsRelease; resultsReleased: boolean; showCorrectAnswers: boolean },
  availability: AssignmentAvailability,
  orderedQuestions: QuestionData[],
  answers: Record<string, string | undefined>,
  grade: AttemptGrade
): StudentResult {
  if (!resultsVisible(a, availability)) {
    return {
      released: false,
      message:
        a.resultsRelease === "after_close"
          ? "Your answers were submitted. Results will be available when the exam closes."
          : "Your answers were submitted. Your professor will release the results.",
    };
  }
  return {
    released: true,
    earned: grade.earned,
    possible: grade.possible,
    percentage: percentage(grade.earned, grade.possible),
    questions: orderedQuestions.map((q) => {
      const g = grade.perQuestion[q.id] ?? { correct: false, points: 0 };
      const item: Extract<StudentResult, { released: true }>["questions"][number] = {
        id: q.id,
        question: q.question,
        points: pointsOf(q),
        earned: g.points,
        correct: g.correct,
        yourAnswer: answers[q.id] ?? null,
      };
      if (a.showCorrectAnswers) {
        item.correctAnswer = q.correctAnswer;
        if (q.explanation) item.explanation = q.explanation;
      }
      return item;
    }),
  };
}

/** The attempt's deadline: the earlier of the closing time and start + time limit (null = none). */
export function attemptDeadline(startedAt: Date, closesAt: string | null, timeLimitMinutes: number | null): string | null {
  const limits: number[] = [];
  if (closesAt) limits.push(Date.parse(closesAt));
  if (timeLimitMinutes) limits.push(startedAt.getTime() + timeLimitMinutes * 60_000);
  return limits.length ? new Date(Math.min(...limits)).toISOString() : null;
}

/** "Ana María  Pérez " → "Ana María Pérez"; student IDs compare case- and space-insensitively. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function studentKeyOf(studentId: string): string {
  return studentId.replace(/\s+/g, "").toLowerCase();
}
