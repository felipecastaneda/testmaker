import type { Difficulty, DifficultySetting, QuestionType } from "@/lib/types";

export interface RawGeneratedQuestion {
  type?: string;
  question?: string;
  correctAnswer?: string;
  distractors?: string[];
  explanation?: string;
  sourceQuote?: string;
  difficulty?: string;
}

export interface NormalizedQuestion {
  type: QuestionType;
  question: string;
  correctAnswer: string;
  distractors: string[];
  explanation?: string;
  sourceQuote?: string;
  difficulty?: Difficulty;
}

export interface NormalizeOptions {
  sourceText: string;
  count: number;
  questionTypes: QuestionType[];
  difficulty: DifficultySetting;
  distractorsPerQuestion?: number;
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Clean up model output: drop malformed questions, fix up true/false answers,
 * de-duplicate distractors, and discard "source quotes" that don't actually
 * appear in the document (a cheap hallucination check).
 */
export function normalizeGeneratedQuestions(
  raw: RawGeneratedQuestion[],
  { sourceText, count, questionTypes, difficulty, distractorsPerQuestion = 3 }: NormalizeOptions
): NormalizedQuestion[] {
  const source = squash(sourceText);
  const result: NormalizedQuestion[] = [];

  for (const item of raw) {
    const question = item.question?.trim();
    let correctAnswer = item.correctAnswer?.trim();
    if (!question || !correctAnswer) continue;

    const type: QuestionType = item.type === "true_false" ? "true_false" : "multiple_choice";
    if (!questionTypes.includes(type)) continue;

    let distractors: string[];
    if (type === "true_false") {
      const tf = correctAnswer.toLowerCase();
      if (tf !== "true" && tf !== "false") continue;
      correctAnswer = tf === "true" ? "True" : "False";
      distractors = [correctAnswer === "True" ? "False" : "True"];
    } else {
      const seen = new Set([correctAnswer.toLowerCase()]);
      distractors = [];
      for (const d of item.distractors ?? []) {
        const clean = d?.trim();
        if (!clean || seen.has(clean.toLowerCase())) continue;
        seen.add(clean.toLowerCase());
        distractors.push(clean);
      }
      distractors = distractors.slice(0, distractorsPerQuestion);
      if (distractors.length < 2) continue;
    }

    const quote = item.sourceQuote?.trim().replace(/^["“]|["”]$/g, "");
    const verifiedQuote = quote && quote.length >= 8 && source.includes(squash(quote)) ? quote : undefined;

    const itemDifficulty = DIFFICULTIES.includes(item.difficulty as Difficulty)
      ? (item.difficulty as Difficulty)
      : undefined;

    result.push({
      type,
      question,
      correctAnswer,
      distractors,
      explanation: item.explanation?.trim() || undefined,
      sourceQuote: verifiedQuote,
      difficulty: difficulty === "mixed" ? itemDifficulty : difficulty,
    });
    if (result.length >= count) break;
  }
  return result;
}
