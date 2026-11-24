import { beforeAll, describe, expect, it } from "vitest";
import { buildVariants, escapeGift, toAiken, toDocx, toGift, toPlainText, toPrintableHtml } from "@/lib/exporters";
import { extractTextFromFile } from "@/lib/document-parser";
import type { QuestionData } from "@/lib/types";
import { installXmlDom } from "./setup-dom";

beforeAll(installXmlDom);

const questions: QuestionData[] = Array.from({ length: 8 }, (_, i) => ({
  id: `q${i}`,
  question: `Question ${i}?`,
  correctAnswer: `Right ${i}`,
  distractors: [`Wrong ${i}a`, `Wrong ${i}b`, `Wrong ${i}c`],
  explanation: `Because ${i}.`,
}));
const tf: QuestionData = { id: "tf", type: "true_false", question: "The sky is blue.", correctAnswer: "True", distractors: ["False"] };

describe("buildVariants", () => {
  it("keeps version A in the current order and gives each version a valid answer key", () => {
    const variants = buildVariants(questions, 3);
    expect(variants.map((v) => v.label)).toEqual(["A", "B", "C"]);
    expect(variants[0].questions.map((q) => q.question.id)).toEqual(questions.map((q) => q.id));
    for (const v of variants) {
      expect(new Set(v.questions.map((q) => q.question.id)).size).toBe(questions.length);
      for (const vq of v.questions) expect(vq.options[vq.correctIndex]).toBe(vq.question.correctAnswer);
    }
  });

  it("produces different orders across versions and is deterministic", () => {
    const [a, b] = buildVariants(questions, 2);
    expect(b.questions.map((q) => q.question.id)).not.toEqual(a.questions.map((q) => q.question.id));
    expect(buildVariants(questions, 2)).toEqual(buildVariants(questions, 2));
  });

  it("always lists true/false options as True, False", () => {
    const [v] = buildVariants([tf], 1);
    expect(v.questions[0].options).toEqual(["True", "False"]);
    expect(v.questions[0].correctIndex).toBe(0);
  });
});

describe("text and HTML", () => {
  it("includes answers and explanations in plain text", () => {
    const text = toPlainText("Bio", buildVariants(questions.slice(0, 1), 1));
    expect(text).toMatch(/^Bio\n===\n1 questions · 1 pt\n\nQ1 \(1 pt\): Question 0\?/);
    expect(text).toMatch(/Answer: [A-D]\) Right 0/);
    expect(text).toContain("Why: Because 0.");
  });

  it("shows each question's points and the total", () => {
    const weighted = [{ ...questions[0], points: 2 }, { ...questions[1], points: 1.5 }, questions[2]];
    const [variant] = buildVariants(weighted, 1);
    const text = toPlainText("Bio", [variant]);
    expect(text).toContain("3 questions · 4.5 pts");
    expect(text).toContain("Q1 (2 pts): Question 0?");
    expect(text).toContain("Q2 (1.5 pts): Question 1?");
    expect(text).toContain("Q3 (1 pt): Question 2?");
    const html = toPrintableHtml("Bio", [variant]);
    expect(html).toContain('<span class="pts">(2 pts)</span>');
    expect(html).toContain("3 questions · 4.5 pts");
  });

  it("escapes HTML in the printable version", () => {
    const html = toPrintableHtml("<b>Quiz</b>", buildVariants([{ ...questions[0], question: "<script>x</script>" }], 1));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;Quiz&lt;/b&gt;");
  });
});

describe("docx", () => {
  it("produces a Word file whose text round-trips through the parser", async () => {
    const blob = await toDocx("Biology & <Cells>", buildVariants([...questions.slice(0, 2), tf], 2));
    const text = await extractTextFromFile(new File([blob], "export.docx"));
    expect(text).toContain("Biology & <Cells> (Version A)");
    expect(text).toContain("Biology & <Cells> (Version B)");
    expect(text).toContain("Question 1?");
    expect(text).toContain("Answer Key — Biology & <Cells> (Version A)");
    expect(text).toMatch(/A\) True\nB\) False/);
  });
});

describe("Moodle formats", () => {
  it("escapes GIFT control characters", () => {
    expect(escapeGift("a=b ~c #d {e} f:g \\h")).toBe("a\\=b \\~c \\#d \\{e\\} f\\:g \\\\h");
  });

  it("writes GIFT multiple-choice and true/false questions with feedback", () => {
    const gift = toGift("Quiz", [questions[0], tf]);
    expect(gift).toContain("::Q1::Question 0? {\n  =Right 0\n  ~Wrong 0a\n  ~Wrong 0b\n  ~Wrong 0c\n  ####Because 0.\n}");
    expect(gift).toContain("::Q2::The sky is blue. {TRUE}");
  });

  it("writes Aiken with a correct answer letter", () => {
    const aiken = toAiken([questions[0], tf]);
    const blocks = aiken.trim().split("\n\n");
    expect(blocks).toHaveLength(2);
    const [first] = blocks;
    const letter = first.match(/ANSWER: ([A-D])/)![1];
    expect(first).toContain(`${letter}. Right 0`);
    expect(blocks[1]).toBe("The sky is blue.\nA. True\nB. False\nANSWER: A");
  });
});
