'use server';
/**
 * @fileOverview This file implements a Genkit flow to generate multiple-choice questions
 *               with correct answers from provided document content.
 *
 * - generateMultipleChoiceQuestions - A function that handles the multiple-choice question generation process.
 * - GenerateMultipleChoiceQuestionsInput - The input type for the generateMultipleChoiceQuestions function.
 * - GenerateMultipleChoiceQuestionsOutput - The return type for the generateMultipleChoiceQuestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateMultipleChoiceQuestionsInputSchema = z.object({
  documentContent: z
    .string()
    .describe('The content of the uploaded document (e.g., Word, Excel, or plain text).'),
  numberOfQuestions: z.number().int().min(1).max(50).default(5).describe('The number of questions to generate.'),
  model: z.string().optional().default('googleai/gemini-2.5-flash'),
  specialInstructions: z.string().optional().describe('Special instructions or recommendations for the test generation.'),
});
export type GenerateMultipleChoiceQuestionsInput = z.infer<
  typeof GenerateMultipleChoiceQuestionsInputSchema
>;

const QuestionSchema = z.object({
  question: z.string().describe('The text of the multiple-choice question.'),
  correctAnswer: z.string().describe('The correct answer for the question.'),
});

const GenerateMultipleChoiceQuestionsOutputSchema = z.object({
  questions: z
    .array(QuestionSchema)
    .describe('An array of generated multiple-choice questions, each with a correct answer.'),
});
export type GenerateMultipleChoiceQuestionsOutput = z.infer<
  typeof GenerateMultipleChoiceQuestionsOutputSchema
>;

export async function generateMultipleChoiceQuestions(
  input: GenerateMultipleChoiceQuestionsInput
): Promise<GenerateMultipleChoiceQuestionsOutput> {
  return generateMultipleChoiceQuestionsFlow(input);
}

const generateMultipleChoiceQuestionsPrompt = ai.definePrompt({
  name: 'generateMultipleChoiceQuestionsPrompt',
  input: {schema: GenerateMultipleChoiceQuestionsInputSchema},
  output: {schema: GenerateMultipleChoiceQuestionsOutputSchema},
  prompt: `You are an expert test maker. Your task is to read the provided document content and create exactly {{numberOfQuestions}} multiple-choice questions based on it.
For each question, provide the question text and the single correct answer. Do not include distractor answers in this step.
The output must be a JSON array of exactly {{numberOfQuestions}} objects, where each object has a 'question' field and a 'correctAnswer' field.

{{#if specialInstructions}}
SPECIAL INSTRUCTIONS:
{{specialInstructions}}
{{/if}}

Document Content:
{{{documentContent}}}`,
});

const generateMultipleChoiceQuestionsFlow = ai.defineFlow(
  {
    name: 'generateMultipleChoiceQuestionsFlow',
    inputSchema: GenerateMultipleChoiceQuestionsInputSchema,
    outputSchema: GenerateMultipleChoiceQuestionsOutputSchema,
  },
  async input => {
    const {output} = await generateMultipleChoiceQuestionsPrompt(input, {
      model: input.model as any,
    });
    return output!;
  }
);
