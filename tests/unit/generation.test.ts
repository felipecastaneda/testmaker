import { describe, expect, it } from "vitest";
import { apportion, chunkDocument, dedupeQuestions, planBatches } from "@/lib/generation";

describe("chunkDocument", () => {
  it("returns short documents as a single chunk", () => {
    expect(chunkDocument("  hello world  ", 100)).toEqual(["hello world"]);
    expect(chunkDocument("   ", 100)).toEqual([]);
  });

  it("splits on paragraph boundaries and never exceeds the limit", () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(10).trim());
    const doc = paragraphs.join("\n\n");
    const chunks = chunkDocument(doc, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    // No paragraph is cut in half.
    for (const c of chunks) expect(c.startsWith("Paragraph")).toBe(true);
    // Nothing is lost.
    expect(chunks.join(" ").replace(/\s+/g, "")).toBe(doc.replace(/\s+/g, ""));
  });

  it("hard-splits text without any separators", () => {
    const chunks = chunkDocument("x".repeat(1050), 500);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 50]);
  });
});

describe("apportion", () => {
  it("splits proportionally and always sums to the total", () => {
    expect(apportion(5, [1, 1])).toEqual([3, 2]);
    expect(apportion(10, [3, 1])).toEqual([8, 2]);
    expect(apportion(7, [1, 1, 1])).toEqual([3, 2, 2]);
    for (let total = 0; total < 40; total++) {
      expect(apportion(total, [5, 3, 9, 1]).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("handles empty or zero weights", () => {
    expect(apportion(5, [])).toEqual([]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
  });
});

describe("planBatches", () => {
  const sum = (b: { count: number }[]) => b.reduce((n, x) => n + x.count, 0);

  it("requests exactly the total across models", () => {
    const batches = planBatches(["chunk"], ["a", "b"], 5);
    expect(sum(batches)).toBe(5);
    expect(batches.map((b) => b.model).sort()).toEqual(["a", "b"]);
  });

  it("caps batch size", () => {
    const batches = planBatches(["chunk"], ["a"], 40, 15);
    expect(batches.map((b) => b.count)).toEqual([15, 15, 10]);
  });

  it("spreads questions over chunks by length and skips empty shares", () => {
    const batches = planBatches(["x".repeat(300), "x".repeat(100)], ["a"], 4);
    expect(batches).toEqual([
      { chunkIndex: 0, model: "a", count: 3 },
      { chunkIndex: 1, model: "a", count: 1 },
    ]);
    expect(planBatches(["c1", "c2", "c3"], ["a", "b"], 1)).toHaveLength(1);
  });

  it("rotates which model gets the remainder", () => {
    const batches = planBatches(["aaaa", "aaaa"], ["a", "b"], 6);
    const perModel = batches.reduce<Record<string, number>>((m, b) => ({ ...m, [b.model]: (m[b.model] ?? 0) + b.count }), {});
    expect(perModel).toEqual({ a: 3, b: 3 });
  });

  it("returns nothing for empty input", () => {
    expect(planBatches([], ["a"], 5)).toEqual([]);
    expect(planBatches(["c"], [], 5)).toEqual([]);
    expect(planBatches(["c"], ["a"], 0)).toEqual([]);
  });
});

describe("dedupeQuestions", () => {
  it("removes rewordings of the same question", () => {
    const result = dedupeQuestions([
      { question: "What is the powerhouse of the cell?", correctAnswer: "Mitochondria" },
      { question: "What is the powerhouse of the cell called?", correctAnswer: "The mitochondria" },
      { question: "Which organelle is called the powerhouse of the cell?", correctAnswer: "Mitochondria" },
      { question: "Where does photosynthesis take place?", correctAnswer: "Chloroplast" },
    ]);
    expect(result.map((q) => q.question)).toEqual([
      "What is the powerhouse of the cell?",
      "Where does photosynthesis take place?",
    ]);
  });

  it("keeps distinct questions that share vocabulary but differ in answer", () => {
    const qs = [
      { question: "Which planet in the solar system is the largest by mass?", correctAnswer: "Jupiter" },
      { question: "Which planet in the solar system is the smallest by mass?", correctAnswer: "Mercury" },
    ];
    expect(dedupeQuestions(qs)).toHaveLength(2);
  });
});
