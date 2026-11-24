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

export const DEFAULT_POINTS = 1;
export const MAX_POINTS = 100;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

export function pointsOf(q: Pick<QuestionData, "points">): number {
  return typeof q.points === "number" && Number.isFinite(q.points) && q.points >= 0 ? q.points : DEFAULT_POINTS;
}

export function totalPoints(questions: Pick<QuestionData, "points">[]): number {
  return questions.reduce((sum, q) => sum + pointsOf(q), 0);
}

/** "1 pt", "2 pts", "1.5 pts". */
export function formatPoints(points: number): string {
  const n = Number.isInteger(points) ? String(points) : String(Math.round(points * 100) / 100);
  return `${n} ${points === 1 ? "pt" : "pts"}`;
}

/**
 * Clean tags: trimmed, lower-case, single spaces, no "#", no duplicates, at most
 * `max` tags of MAX_TAG_LENGTH characters. Accepts an array or comma-separated text.
 */
export function normalizeTags(raw: unknown, max = MAX_TAGS): string[] {
  const items = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const tag = item.replace(/^#+/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, MAX_TAG_LENGTH).trim();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
