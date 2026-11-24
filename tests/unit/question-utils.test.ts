import { describe, expect, it } from "vitest";
import { formatPoints, normalizeTags, pointsOf, totalPoints } from "@/lib/question-utils";
import { toStudentQuestion } from "@/lib/student-view";
import type { QuestionData } from "@/lib/types";

const q = (over: Partial<QuestionData> = {}): QuestionData => ({
  id: "q1",
  question: "What powers the cell?",
  correctAnswer: "Mitochondria",
  distractors: ["Ribosome", "Nucleus", "Golgi"],
  type: "multiple_choice",
  difficulty: "medium",
  explanation: "Mitochondria make ATP.",
  sourceQuote: "The mitochondria is the powerhouse of the cell.",
  sourceModel: "openai/gpt-5.5",
  tags: ["organelles"],
  points: 2,
  ...over,
});

describe("points", () => {
  it("defaults to 1 for missing or invalid values", () => {
    expect(pointsOf({})).toBe(1);
    expect(pointsOf({ points: -3 })).toBe(1);
    expect(pointsOf({ points: Number.NaN })).toBe(1);
    expect(pointsOf({ points: 0 })).toBe(0);
    expect(pointsOf({ points: 2.5 })).toBe(2.5);
  });

  it("totals and formats", () => {
    expect(totalPoints([{ points: 2 }, {}, { points: 0.5 }])).toBe(3.5);
    expect(formatPoints(1)).toBe("1 pt");
    expect(formatPoints(2)).toBe("2 pts");
    expect(formatPoints(1.5)).toBe("1.5 pts");
    expect(formatPoints(0)).toBe("0 pts");
  });
});

describe("normalizeTags", () => {
  it("cleans, lower-cases and de-duplicates", () => {
    expect(normalizeTags(["  Cell   Biology ", "#ATP", "cell biology", "", 5])).toEqual(["cell biology", "atp"]);
  });

  it("accepts comma-separated text and limits count and length", () => {
    expect(normalizeTags("a, b, c, d", 3)).toEqual(["a", "b", "c"]);
    expect(normalizeTags(["x".repeat(60)])[0]).toHaveLength(40);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe("toStudentQuestion", () => {
  it("never reveals the answer or authoring details", () => {
    const view = toStudentQuestion(q(), "student-1");
    expect(Object.keys(view).sort()).toEqual(["id", "options", "points", "question", "type"]);
    const json = JSON.stringify(view);
    for (const secret of ["Mitochondria make ATP", "powerhouse", "openai", "organelles", "medium", "correctAnswer", "distractors"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("includes every option, in a stable per-seed order", () => {
    const a = toStudentQuestion(q(), "student-1");
    expect([...a.options].sort()).toEqual(["Golgi", "Mitochondria", "Nucleus", "Ribosome"]);
    expect(toStudentQuestion(q(), "student-1").options).toEqual(a.options);
    const orders = new Set(Array.from({ length: 20 }, (_, i) => toStudentQuestion(q(), `s${i}`).options.join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("keeps points, images and true/false order", () => {
    const tf = toStudentQuestion(q({ type: "true_false", correctAnswer: "False", distractors: ["True"], points: undefined, imageUrl: "https://x/y.png" }), "s");
    expect(tf).toMatchObject({ options: ["True", "False"], points: 1, imageUrl: "https://x/y.png" });
  });
});
