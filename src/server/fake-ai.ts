import "server-only";
import type { RawGeneratedQuestion } from "@/ai/normalize";
import type { QuestionType } from "@/lib/types";

/**
 * Deterministic stand-in for the LLM, used by the end-to-end tests
 * (TESTMAKER_FAKE_AI=1, never honoured in production). Builds questions from the
 * sentences of the chunk so the output is still tied to the document.
 */
export function fakeGenerate(
  chunk: string,
  count: number,
  types: QuestionType[],
  model: string,
  instructions?: string
): RawGeneratedQuestion[] {
  // Echo instructions so tests can see what reached the prompt.
  const note = instructions ? ` [Instructions: ${instructions.replace(/\s+/g, " ")}]` : "";
  const sentences = chunk
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  // Different models start from different sentences, like real models would ask different things.
  const offset = model.startsWith("googleai") ? Math.floor(sentences.length / 2) : 0;
  const out: RawGeneratedQuestion[] = [];
  for (let j = 0; j < count; j++) {
    const i = offset + j;
    const sentence = sentences[i % Math.max(1, sentences.length)] ?? chunk.slice(0, 80);
    const type = types[i % types.length];
    if (type === "true_false") {
      out.push({
        type,
        question: `True or false (#${i + 1}): ${sentence}`,
        correctAnswer: "True",
        distractors: [],
        explanation: `The statement is taken directly from the material.${note}`,
        sourceQuote: sentence,
        difficulty: "easy",
        tags: ["Cell Biology", "true or false"],
      });
    } else {
      out.push({
        type,
        question: `Fake question #${i + 1} about: ${sentence.slice(0, 60)}`,
        correctAnswer: `Correct answer ${i + 1}`,
        distractors: [`Wrong answer ${i + 1}a`, `Wrong answer ${i + 1}b`, `Wrong answer ${i + 1}c`],
        explanation: `Because the material says so.${note}`,
        sourceQuote: sentence,
        difficulty: "medium",
        tags: ["Cell Biology", "#Organelles"],
      });
    }
  }
  return out;
}
