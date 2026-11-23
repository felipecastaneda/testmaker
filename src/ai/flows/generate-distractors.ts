'use server';
/**
 * @fileOverview A Genkit flow for generating plausible, incorrect answer options (distractors) for multiple-choice questions.
 *
 * - generateDistractors - A function that generates distractors for a given question and correct answer.
 * - GenerateDistractorsInput - The input type for the generateDistractors function.
 * - GenerateDistractorsOutput - The return type for the generateDistractors function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { DEFAULT_MODEL_ID } from '@/ai/models';

const GenerateDistractorsInputSchema = z.object({
  question: z.string().describe('The multiple-choice question.'),
  correctAnswer: z.string().describe('The correct answer to the question.'),
  numberOfDistractors: z.number().int().min(1).max(5).default(3).describe('The desired number of distractors to generate.'),
  model: z.string().optional().default(DEFAULT_MODEL_ID),
});
export type GenerateDistractorsInput = z.infer<typeof GenerateDistractorsInputSchema>;

const GenerateDistractorsOutputSchema = z.array(z.string()).describe('A list of plausible but incorrect answer options (distractors).');
export type GenerateDistractorsOutput = z.infer<typeof GenerateDistractorsOutputSchema>;

export async function generateDistractors(input: GenerateDistractorsInput): Promise<GenerateDistractorsOutput> {
  return generateDistractorsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateDistractorsPrompt',
  input: { schema: GenerateDistractorsInputSchema },
  output: { schema: GenerateDistractorsOutputSchema },
  prompt: `You are an expert at creating challenging multiple-choice questions and answers. Your task is to generate plausible, incorrect answer options (distractors) for a given multiple-choice question and its correct answer.

Generate exactly {{numberOfDistractors}} unique distractors.

The distractors should be:
- Plausible and related to the question, but clearly incorrect.
- Distinct from the correct answer.
- Varied in their nature, avoiding obvious patterns.

Question: {{{question}}}
Correct Answer: {{{correctAnswer}}}

Generate {{numberOfDistractors}} distractors as a JSON array of strings.`,
});

const generateDistractorsFlow = ai.defineFlow(
  {
    name: 'generateDistractorsFlow',
    inputSchema: GenerateDistractorsInputSchema,
    outputSchema: GenerateDistractorsOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input, {
      model: input.model,
    });
    if (!output) {
      throw new Error(`Model ${input.model} returned no distractors.`);
    }

    // Models occasionally repeat themselves or echo the correct answer; filter those out
    // so the student never sees two identical (or two correct) options.
    const normalize = (s: string) => s.trim().toLowerCase();
    const seen = new Set([normalize(input.correctAnswer)]);
    const distractors: string[] = [];
    for (const raw of output) {
      const candidate = raw.trim();
      const key = normalize(candidate);
      if (!candidate || seen.has(key)) continue;
      seen.add(key);
      distractors.push(candidate);
    }
    return distractors.slice(0, input.numberOfDistractors);
  }
);
