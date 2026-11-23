import { seededShuffle } from "./utils";
import type { QuestionData } from "./types";

export const optionLetter = (index: number) => String.fromCharCode(65 + index);

export function isTrueFalse(q: QuestionData): boolean {
  return q.type === "true_false";
}

/**
 * The answer options for a question in display order. True/false questions always
 * read "True, False"; multiple-choice options are shuffled deterministically by `seed`.
 */
export function orderOptions(q: QuestionData, seed: string): string[] {
  if (isTrueFalse(q)) return ["True", "False"];
  return seededShuffle([q.correctAnswer, ...q.distractors], `${q.id}:${seed}`);
}
