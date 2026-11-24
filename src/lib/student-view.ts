import { orderOptions, pointsOf } from "./question-utils";
import type { QuestionData, QuestionType } from "./types";

/**
 * What a student may see of a question: no correct answer, explanation, source quote,
 * model, tags or difficulty. Options come pre-mixed (seeded, so a student sees the same
 * order every time). Every place that sends questions to students must use this.
 */
export interface StudentQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options: string[];
  points: number;
  imageUrl?: string;
}

export function toStudentQuestion(q: QuestionData, seed: string): StudentQuestion {
  const view: StudentQuestion = {
    id: q.id,
    type: q.type ?? "multiple_choice",
    question: q.question,
    options: orderOptions(q, seed),
    points: pointsOf(q),
  };
  if (q.imageUrl) view.imageUrl = q.imageUrl;
  return view;
}
