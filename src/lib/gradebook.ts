import type { AttemptGrade } from "./grading";
import { percentage } from "./grading";
import type { AssignmentSummary } from "./types";

/** A question as the professor sees it in the gradebook (includes the key). */
export interface GradebookQuestion {
  id: string;
  question: string;
  correctAnswer: string;
  /** All answer options (correct one included). */
  options: string[];
  points: number;
  /** Regrade: extra options counted as correct, or ["*"] for full credit. */
  accepted: string[];
}

export interface GradebookAttempt {
  id: string;
  studentName: string;
  studentId: string;
  status: "in_progress" | "submitted";
  startedAt: string;
  submittedAt: string | null;
  submittedBy: "student" | "deadline" | "teacher" | null;
  deadline: string | null;
  /** The professor gave extra time. */
  extended: boolean;
  answers: Record<string, string>;
  grade: AttemptGrade | null;
  /** Times the student left the exam page (informational). */
  focusLosses: number;
}

export interface GradebookView {
  assignment: AssignmentSummary;
  questions: GradebookQuestion[];
  attempts: GradebookAttempt[];
}

export interface QuestionStats {
  answered: number;
  correct: number;
  /** % of submitted attempts that got it right; null when nobody has submitted. */
  percentCorrect: number | null;
  /** How many submitted attempts chose each option. */
  choices: Record<string, number>;
}

/** Per-question statistics over submitted attempts (simple item analysis). */
export function questionStats(questions: GradebookQuestion[], attempts: GradebookAttempt[]): Record<string, QuestionStats> {
  const submitted = attempts.filter((a) => a.status === "submitted" && a.grade);
  const out: Record<string, QuestionStats> = {};
  for (const q of questions) {
    const choices: Record<string, number> = {};
    let answered = 0;
    let correct = 0;
    for (const a of submitted) {
      const answer = a.answers[q.id];
      if (answer !== undefined) {
        answered++;
        choices[answer] = (choices[answer] ?? 0) + 1;
      }
      if (a.grade!.perQuestion[q.id]?.correct) correct++;
    }
    out[q.id] = {
      answered,
      correct,
      percentCorrect: submitted.length ? Math.round((correct / submitted.length) * 100) : null,
      choices,
    };
  }
  return out;
}

export function averagePercent(attempts: GradebookAttempt[]): number | null {
  const graded = attempts.filter((a) => a.status === "submitted" && a.grade);
  if (!graded.length) return null;
  return Math.round(graded.reduce((sum, a) => sum + percentage(a.grade!.earned, a.grade!.possible), 0) / graded.length);
}

export function minutesTaken(a: Pick<GradebookAttempt, "startedAt" | "submittedAt">): number | null {
  if (!a.submittedAt) return null;
  return Math.max(0, Math.round((Date.parse(a.submittedAt) - Date.parse(a.startedAt)) / 60_000));
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // Quote when needed; neutralise formulas so a name like "=HYPERLINK(...)" stays text in Excel.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Gradebook as CSV (one row per student). Starts with a UTF-8 BOM so Excel shows accents
 * correctly. Per-question columns hold points earned; in-progress attempts have no score.
 */
export function gradebookCsv(view: GradebookView): string {
  const header = [
    "Name",
    "Student ID",
    "Status",
    "Started",
    "Submitted",
    "Minutes",
    "Score",
    "Possible",
    "Percent",
    "Left page",
    ...view.questions.map((_, i) => `Q${i + 1}`),
  ];
  const rows = [...view.attempts]
    .sort((a, b) => a.studentName.localeCompare(b.studentName))
    .map((a) => {
      const g = a.status === "submitted" ? a.grade : null;
      return [
        a.studentName,
        a.studentId,
        a.status === "in_progress" ? "In progress" : a.submittedBy === "deadline" ? "Submitted (time/close)" : "Submitted",
        a.startedAt,
        a.submittedAt,
        minutesTaken(a),
        g ? g.earned : null,
        g ? g.possible : null,
        g ? percentage(g.earned, g.possible) : null,
        a.focusLosses,
        ...view.questions.map((q) => (g ? (g.perQuestion[q.id]?.points ?? 0) : null)),
      ];
    });
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
