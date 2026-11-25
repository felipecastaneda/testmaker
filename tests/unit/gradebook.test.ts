import { describe, expect, it } from "vitest";
import { averagePercent, gradebookCsv, minutesTaken, questionStats, type GradebookAttempt, type GradebookView } from "@/lib/gradebook";
import { gradeAttempt } from "@/lib/grading";
import type { AssignmentSummary, QuestionData } from "@/lib/types";

const keys: QuestionData[] = [
  { id: "q1", question: "Powerhouse?", correctAnswer: "Mitochondria", distractors: ["Nucleus", "Ribosome"], points: 2 },
  { id: "q2", question: "Sky blue?", type: "true_false", correctAnswer: "True", distractors: ["False"] },
];
const questions = keys.map((q) => ({
  id: q.id,
  question: q.question,
  correctAnswer: q.correctAnswer,
  options: [q.correctAnswer, ...q.distractors],
  points: q.points ?? 1,
  accepted: [],
}));

function attempt(over: Partial<GradebookAttempt> & { answers: Record<string, string> }): GradebookAttempt {
  return {
    id: over.studentId ?? "x",
    studentName: "Student",
    studentId: "S",
    status: "submitted",
    startedAt: "2026-12-01T10:00:00.000Z",
    submittedAt: "2026-12-01T10:12:00.000Z",
    submittedBy: "student",
    deadline: null,
    extended: false,
    grade: gradeAttempt(keys, over.answers),
    focusLosses: 0,
    ...over,
  };
}

const attempts = [
  attempt({ studentName: "Zoë Álvarez", studentId: "Z1", answers: { q1: "Mitochondria", q2: "True" } }),
  attempt({ studentName: "Ana", studentId: "A1", answers: { q1: "Nucleus" }, submittedBy: "deadline" }),
  attempt({ studentName: "Mid Way", studentId: "M1", answers: { q1: "Mitochondria" }, status: "in_progress", submittedAt: null, submittedBy: null, grade: null, focusLosses: 3 }),
];

describe("questionStats", () => {
  it("counts correct answers and choices over submitted attempts only", () => {
    const stats = questionStats(questions, attempts);
    expect(stats.q1).toEqual({ answered: 2, correct: 1, percentCorrect: 50, choices: { Mitochondria: 1, Nucleus: 1 } });
    expect(stats.q2).toEqual({ answered: 1, correct: 1, percentCorrect: 50, choices: { True: 1 } });
    expect(questionStats(questions, []).q1.percentCorrect).toBeNull();
  });

  it("averages percentages and measures time", () => {
    expect(averagePercent(attempts)).toBe(50); // 100% and 0%
    expect(averagePercent([])).toBeNull();
    expect(minutesTaken(attempts[0])).toBe(12);
    expect(minutesTaken(attempts[2])).toBeNull();
  });
});

describe("gradebookCsv", () => {
  const view: GradebookView = { assignment: {} as AssignmentSummary, questions, attempts };
  const csv = gradebookCsv(view);
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("starts with a BOM so Excel reads accents", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Zoë Álvarez");
  });

  it("has one row per student, sorted by name, with scores and per-question points", () => {
    expect(lines[0]).toBe("Name,Student ID,Status,Started,Submitted,Minutes,Score,Possible,Percent,Left page,Q1,Q2");
    expect(lines[1]).toBe("Ana,A1,Submitted (time/close),2026-12-01T10:00:00.000Z,2026-12-01T10:12:00.000Z,12,0,3,0,0,0,0");
    expect(lines[2]).toBe("Mid Way,M1,In progress,2026-12-01T10:00:00.000Z,,,,,,3,,");
    expect(lines[3]).toBe("Zoë Álvarez,Z1,Submitted,2026-12-01T10:00:00.000Z,2026-12-01T10:12:00.000Z,12,3,3,100,0,2,1");
  });

  it("quotes commas and quotes, and neutralises spreadsheet formulas", () => {
    const tricky = gradebookCsv({
      ...view,
      attempts: [attempt({ studentName: 'Pérez, "Juan"', studentId: "=HYPERLINK(1)", answers: {} })],
    });
    expect(tricky).toContain('"Pérez, ""Juan"""');
    expect(tricky).toContain("'=HYPERLINK(1)");
  });
});
