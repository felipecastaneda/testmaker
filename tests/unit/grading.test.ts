import { describe, expect, it } from "vitest";
import { attemptDeadline, cleanName, gradeAttempt, resultsVisible, studentKeyOf, studentResult } from "@/lib/grading";
import type { QuestionData } from "@/lib/types";

const qs: QuestionData[] = [
  { id: "a", question: "Powerhouse?", correctAnswer: "Mitochondria", distractors: ["Nucleus", "Ribosome"], points: 2, explanation: "ATP." },
  { id: "b", question: "Sky is blue.", type: "true_false", correctAnswer: "True", distractors: ["False"] },
  { id: "c", question: "Proteins?", correctAnswer: "Ribosome", distractors: ["Golgi", "Lysosome"], points: 1.5 },
];

describe("gradeAttempt", () => {
  it("awards each question's points when the answer matches the key", () => {
    const g = gradeAttempt(qs, { a: "Mitochondria", b: "False" });
    expect(g).toEqual({
      earned: 2,
      possible: 4.5,
      perQuestion: { a: { correct: true, points: 2 }, b: { correct: false, points: 0 }, c: { correct: false, points: 0 } },
    });
  });

  it("honours regrades: extra accepted answers and full credit for everyone", () => {
    const regraded = [{ ...qs[0], accepted: ["Nucleus"] }, { ...qs[1], accepted: ["*"] }, qs[2]];
    const g = gradeAttempt(regraded, { a: "Nucleus" });
    expect(g.perQuestion.a.correct).toBe(true);
    expect(g.perQuestion.b).toEqual({ correct: true, points: 1 }); // even unanswered
    expect(g.earned).toBe(3);
  });
});

describe("results release", () => {
  const base = { resultsReleased: false, showCorrectAnswers: true };
  it("follows the policy", () => {
    expect(resultsVisible({ ...base, resultsRelease: "immediately" }, "open")).toBe(true);
    expect(resultsVisible({ ...base, resultsRelease: "after_close" }, "open")).toBe(false);
    expect(resultsVisible({ ...base, resultsRelease: "after_close" }, "closed")).toBe(true);
    expect(resultsVisible({ ...base, resultsRelease: "manual" }, "closed")).toBe(false);
    expect(resultsVisible({ ...base, resultsRelease: "manual", resultsReleased: true }, "open")).toBe(true);
  });

  const answers = { a: "Nucleus", b: "True" };
  const grade = gradeAttempt(qs, answers);

  it("reveals nothing before release", () => {
    const r = studentResult({ ...base, resultsRelease: "after_close" }, "open", qs, answers, grade);
    expect(r).toEqual({ released: false, message: expect.stringContaining("when the exam closes") });
    expect(JSON.stringify(r)).not.toMatch(/Mitochondria|ATP|earned/);
  });

  it("shows score and, if allowed, correct answers and explanations", () => {
    const r = studentResult({ ...base, resultsRelease: "immediately" }, "open", qs, answers, grade);
    if (!r.released) throw new Error("expected released");
    expect(r).toMatchObject({ earned: 1, possible: 4.5, percentage: 22 });
    expect(r.questions[0]).toEqual({
      id: "a", question: "Powerhouse?", points: 2, earned: 0, correct: false, yourAnswer: "Nucleus", correctAnswer: "Mitochondria", explanation: "ATP.",
    });
    expect(r.questions[2].yourAnswer).toBeNull();
  });

  it("hides correct answers and explanations when the assignment says so", () => {
    const r = studentResult({ ...base, showCorrectAnswers: false, resultsRelease: "immediately" }, "open", qs, answers, grade);
    expect(JSON.stringify(r)).not.toMatch(/Mitochondria|ATP|correctAnswer|explanation/);
  });
});

describe("attemptDeadline", () => {
  const start = new Date("2026-12-01T10:00:00.000Z");
  it("is the earlier of the close time and start + limit", () => {
    expect(attemptDeadline(start, null, null)).toBeNull();
    expect(attemptDeadline(start, null, 30)).toBe("2026-12-01T10:30:00.000Z");
    expect(attemptDeadline(start, "2026-12-01T10:20:00.000Z", 30)).toBe("2026-12-01T10:20:00.000Z");
    expect(attemptDeadline(start, "2026-12-01T12:00:00.000Z", 30)).toBe("2026-12-01T10:30:00.000Z");
  });
});

describe("student identity", () => {
  it("cleans names and compares IDs ignoring case and spaces", () => {
    expect(cleanName("  Ana   María Pérez ")).toBe("Ana María Pérez");
    expect(studentKeyOf(" A00 123-45 ")).toBe("a00123-45");
    expect(studentKeyOf("a00123-45")).toBe(studentKeyOf("A00 123-45"));
  });
});
