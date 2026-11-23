import { describe, expect, it } from "vitest";
import { normalizeGeneratedQuestions } from "@/ai/normalize";

const SOURCE = "The mitochondria is the powerhouse of the cell. It produces ATP through cellular respiration.";
const base = { sourceText: SOURCE, count: 10, questionTypes: ["multiple_choice", "true_false"] as const, difficulty: "mixed" as const };
const opts = { ...base, questionTypes: [...base.questionTypes] };

describe("normalizeGeneratedQuestions", () => {
  it("cleans distractors: trims, removes duplicates and the correct answer, caps at 3", () => {
    const [q] = normalizeGeneratedQuestions(
      [
        {
          type: "multiple_choice",
          question: " What produces ATP? ",
          correctAnswer: "Mitochondria",
          distractors: ["Nucleus", "nucleus", " mitochondria ", "", "Ribosome", "Golgi", "Lysosome"],
          difficulty: "easy",
        },
      ],
      opts
    );
    expect(q.question).toBe("What produces ATP?");
    expect(q.distractors).toEqual(["Nucleus", "Ribosome", "Golgi"]);
    expect(q.difficulty).toBe("easy");
  });

  it("drops multiple-choice questions with fewer than two usable distractors", () => {
    const out = normalizeGeneratedQuestions(
      [{ type: "multiple_choice", question: "Q?", correctAnswer: "A", distractors: ["A", "B"] }],
      opts
    );
    expect(out).toEqual([]);
  });

  it("normalises true/false answers and supplies the opposite as the only distractor", () => {
    const [q] = normalizeGeneratedQuestions(
      [{ type: "true_false", question: "Mitochondria produce ATP.", correctAnswer: "true", distractors: ["nonsense"] }],
      opts
    );
    expect(q.correctAnswer).toBe("True");
    expect(q.distractors).toEqual(["False"]);
  });

  it("drops true/false questions with non-boolean answers and disallowed types", () => {
    expect(
      normalizeGeneratedQuestions([{ type: "true_false", question: "X?", correctAnswer: "Maybe" }], opts)
    ).toEqual([]);
    expect(
      normalizeGeneratedQuestions([{ type: "true_false", question: "X?", correctAnswer: "True" }], {
        ...opts,
        questionTypes: ["multiple_choice"],
      })
    ).toEqual([]);
  });

  it("keeps only source quotes that really appear in the document", () => {
    const [real, fake] = normalizeGeneratedQuestions(
      [
        { type: "true_false", question: "A", correctAnswer: "True", sourceQuote: "“the  POWERHOUSE of the cell”" },
        { type: "true_false", question: "B", correctAnswer: "False", sourceQuote: "Mitochondria were discovered in 1857." },
      ],
      opts
    );
    expect(real.sourceQuote).toBe("the  POWERHOUSE of the cell");
    expect(fake.sourceQuote).toBeUndefined();
  });

  it("forces the requested difficulty and respects the count", () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ type: "true_false", question: `Q${i}`, correctAnswer: "True", difficulty: "easy" }));
    const out = normalizeGeneratedQuestions(raw, { ...opts, count: 3, difficulty: "hard" });
    expect(out).toHaveLength(3);
    expect(out.every((q) => q.difficulty === "hard")).toBe(true);
  });
});
