import { describe, expect, it } from "vitest";
import { gradebookCsv, type GradebookAttempt } from "@/lib/gradebook";
import { gradeAttempt } from "@/lib/grading";
import {
  lettersToAnswers,
  lettersToText,
  normalizePaperId,
  paperMaxQuestions,
  paperProblem,
  paperVariants,
  parseTypedAnswers,
} from "@/lib/paper";
import { paperPrintHtml } from "@/lib/paper-print";
import { BUBBLE_RADIUS, CODE_BITS, decodeSheetCode, MARKER_SIZE, SHEET, sheetCodeBits, sheetLayout } from "@/lib/paper-sheet";
import type { AssignmentSummary, QuestionData } from "@/lib/types";

const q = (i: number, extra: Partial<QuestionData> = {}): QuestionData => ({
  id: `q${i}`,
  question: `Question ${i}?`,
  correctAnswer: `right ${i}`,
  distractors: [`wrong ${i}a`, `wrong ${i}b`, `wrong ${i}c`],
  ...extra,
});
const questions = [q(1), q(2, { type: "true_false", correctAnswer: "True", distractors: ["False"] }), q(3), q(4)];

describe("paper versions", () => {
  it("are repeatable per seed and differ between assignments", () => {
    const a1 = paperVariants(questions, 3, "seed-a");
    const a2 = paperVariants(questions, 3, "seed-a");
    const b = paperVariants(questions, 3, "seed-b");
    expect(a1.map((v) => v.label)).toEqual(["A", "B", "C"]);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(JSON.stringify(a1)).not.toBe(JSON.stringify(b));
    // Version A keeps the assignment's question order.
    expect(a1[0].questions.map((x) => x.question.id)).toEqual(["q1", "q2", "q3", "q4"]);
    // True/false always reads True, False.
    for (const v of a1) expect(v.questions.find((x) => x.question.id === "q2")!.options).toEqual(["True", "False"]);
  });

  it("refuses tests that don't fit on a sheet", () => {
    expect(paperProblem(questions, "letters_digits")).toBeNull();
    const many = Array.from({ length: 76 }, (_, i) => q(i));
    expect(paperProblem(many, "letters_digits")).toMatch(/at most 75/);
    expect(paperProblem(many, "digits")).toBeNull();
    expect(paperProblem([q(1, { distractors: ["a", "b", "c", "d", "e"] })], "digits")).toMatch(/6 options/);
  });
});

describe("student IDs on paper", () => {
  it("normalises and checks the charset and length", () => {
    expect(normalizePaperId(" ab 12c ", { idLength: 8, idCharset: "letters_digits" })).toEqual({ id: "AB12C" });
    expect(normalizePaperId("AB12C", { idLength: 4, idCharset: "letters_digits" })).toHaveProperty("error");
    expect(normalizePaperId("AB12", { idLength: 8, idCharset: "digits" })).toHaveProperty("error");
    expect(normalizePaperId("A-1", { idLength: 8, idCharset: "letters_digits" })).toHaveProperty("error");
    expect(normalizePaperId("  ", { idLength: 8, idCharset: "digits" })).toHaveProperty("error");
  });
});

describe("typed answers", () => {
  const [A, B] = paperVariants(questions, 2, "s");

  it("parses letters, blanks and spaces; short input leaves the rest blank", () => {
    expect(parseTypedAnswers("a-c", A)).toEqual({ letters: [0, null, 2, null] });
    expect(parseTypedAnswers("A B . D", A)).toEqual({ letters: [0, 1, null, 3] });
  });

  it("rejects too many answers or options a question doesn't have", () => {
    expect(parseTypedAnswers("AAAAA", A)).toHaveProperty("error");
    // Question 2 is true/false: only A or B.
    expect(parseTypedAnswers("AC", A)).toEqual({ error: expect.stringMatching(/Question 2/) });
    expect(parseTypedAnswers("A1", A)).toHaveProperty("error");
  });

  it("maps each version's letters back to the same option text, so grading is per question", () => {
    const keyLetters = (v: typeof A) => v.questions.map((x) => x.correctIndex);
    for (const v of [A, B]) {
      const answers = lettersToAnswers(v, keyLetters(v));
      expect(gradeAttempt(questions, answers)).toMatchObject({ earned: 4, possible: 4 });
    }
    expect(lettersToAnswers(A, [null, null, null, null])).toEqual({});
    expect(lettersToText([0, null, 4])).toBe("A-E");
  });
});

describe("answer sheet layout", () => {
  const inside = (x: number, y: number, r = 0) => x - r >= 0 && y - r >= 0 && x + r <= SHEET.width && y + r <= SHEET.height;
  const overlapsMarker = (x: number, y: number, r: number) =>
    sheetLayout({ idLength: 4, idCharset: "digits" }, []).markers.some((m) => x + r > m.x && x - r < m.x + m.w && y + r > m.y && y - r < m.y + m.h);

  for (const charset of ["letters_digits", "digits"] as const) {
    it(`fits ${charset} IDs and the most questions on the page without overlaps`, () => {
      const n = paperMaxQuestions(charset);
      const L = sheetLayout({ idLength: 12, idCharset: charset }, Array.from({ length: n }, () => 5));
      const all = [...L.idBubbles.flat(), ...L.answerBubbles.flat()];
      expect(L.answerBubbles).toHaveLength(n);
      for (const c of all) {
        expect(inside(c.cx, c.cy, BUBBLE_RADIUS)).toBe(true);
        expect(overlapsMarker(c.cx, c.cy, BUBBLE_RADIUS)).toBe(false);
      }
      // No two bubbles touch.
      const sorted = [...all].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length && sorted[j].cx - sorted[i].cx < 2 * BUBBLE_RADIUS + 0.5; j++) {
          expect(Math.hypot(sorted[j].cx - sorted[i].cx, sorted[j].cy - sorted[i].cy)).toBeGreaterThan(2 * BUBBLE_RADIUS + 0.5);
        }
      }
      expect(L.markers.every((m) => m.w === MARKER_SIZE && inside(m.x, m.y) && inside(m.x + m.w, m.y + m.h))).toBe(true);
    });
  }

  it("fits inside both Letter and A4 with 10 mm margins", () => {
    expect(SHEET.width + 20).toBeLessThanOrEqual(210);
    expect(SHEET.height + 20).toBeLessThanOrEqual(279.4);
  });
});

describe("sheet code strip", () => {
  it("round-trips the version and rejects other assignments", () => {
    const bits = sheetCodeBits("assignment-1", 2);
    expect(bits).toHaveLength(CODE_BITS);
    expect(bits[0]).toBe(1);
    expect(bits[CODE_BITS - 1]).toBe(1);
    expect(decodeSheetCode(bits, "assignment-1", 4)).toBe(2);
    expect(decodeSheetCode(bits, "assignment-2", 4)).toBeNull();
    expect(decodeSheetCode(bits, "assignment-1", 2)).toBeNull(); // version C doesn't exist
    const flipped = [...bits];
    flipped[5] ^= 1;
    expect(decodeSheetCode(flipped, "assignment-1", 4)).toBeNull();
  });
});

describe("paper printing", () => {
  const variants = paperVariants(questions, 2, "s");
  const html = paperPrintHtml({
    assignmentId: "as1",
    title: "Bio <quiz>",
    subtitle: "Biology 101",
    paper: { versions: 2, idLength: 6, idCharset: "letters_digits" },
    variants,
    booklets: true,
    sheetsPerVersion: 3,
    keys: true,
  });

  it("has a booklet, sheets and a key for every version, escaped", () => {
    expect(html.match(/class="booklet"/g)).toHaveLength(2);
    expect(html.match(/class="sheet-page"/g)).toHaveLength(6);
    expect(html.match(/class="key"/g)).toHaveLength(2);
    expect(html).toContain("Bio &lt;quiz&gt;");
    expect(html).not.toContain("Bio <quiz>");
    expect(html).toContain("Version B");
  });

  it("puts the right letter for each question in the key", () => {
    const key = html.slice(html.indexOf('class="key"'));
    const first = variants[0].questions[0];
    expect(key).toContain(`<strong>${"ABCDE"[first.correctIndex]}</strong>`);
  });
});

describe("paper gradebook CSV", () => {
  it("shows version and entry instead of times", () => {
    const keys = questions;
    const attempt: GradebookAttempt = {
      id: "x",
      studentName: "",
      studentId: "AB12",
      status: "submitted",
      startedAt: "2026-12-01T10:00:00.000Z",
      submittedAt: "2026-12-01T10:00:00.000Z",
      submittedBy: "teacher",
      deadline: null,
      extended: false,
      answers: { q1: "right 1" },
      grade: gradeAttempt(keys, { q1: "right 1" }),
      focusLosses: 0,
      source: "paper",
      variant: "B",
      entry: "typed",
      hasScan: false,
    };
    const csv = gradebookCsv({
      assignment: { delivery: "paper" } as AssignmentSummary,
      questions: keys.map((k) => ({ id: k.id, question: k.question, correctAnswer: k.correctAnswer, options: [], points: 1, accepted: [] })),
      attempts: [attempt],
      classList: [],
    });
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Student ID,Version,Entered,Saved,Score,Possible,Percent,Q1,Q2,Q3,Q4");
    expect(lines[1]).toBe(",AB12,B,Typed,2026-12-01T10:00:00.000Z,1,4,25,1,0,0,0");
  });
});

describe("paper keys", () => {
  it("refuses a true/false question whose answer isn't True or False", () => {
    expect(paperProblem([q(1, { type: "true_false", correctAnswer: "Yes", distractors: ["False"] })], "digits")).toMatch(/isn't one of its options/);
  });
});

describe("class lists", () => {
  const letters = { idLength: 8, idCharset: "letters_digits" as const };
  it("reads ID-first and name-first lines, skips a header, reports problems", async () => {
    const { parseClassList, classListText } = await import("@/lib/paper");
    const { entries, problems } = parseClassList(
      ["Student ID, Name", "ab1234, Hana Kim", "Pérez, Juan;CD5678", "Ana\tEF9012", "", "AB1234, again", "not an id at all, x"].join("\n"),
      letters
    );
    expect(entries).toEqual([
      { id: "AB1234", name: "Hana Kim" },
      { id: "CD5678", name: "Pérez, Juan" },
      { id: "EF9012", name: "Ana" },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/listed twice/);
    expect(classListText(entries)).toBe("AB1234, Hana Kim\nCD5678, Pérez, Juan\nEF9012, Ana");
  });

  it("checks IDs against the exam's digit-only setting", async () => {
    const { parseClassList } = await import("@/lib/paper");
    expect(parseClassList("123456, Ana\nAB12, Bo", { idLength: 6, idCharset: "digits" }).entries).toEqual([{ id: "123456", name: "Ana" }]);
  });
});
