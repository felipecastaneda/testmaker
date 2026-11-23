/**
 * Smoke-test every configured model against a tiny document.
 * Usage: npx tsx test-models.ts   (reads API keys from .env.local)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { AVAILABLE_MODELS } from './src/ai/models';
import { generateQuestionSetFlow } from './src/ai/flows/generate-question-set';

const DOCUMENT =
  'The mitochondria is the powerhouse of the cell. It produces ATP through cellular respiration, ' +
  'a process that consumes oxygen and glucose and releases carbon dioxide and water.';

async function main() {
  for (const model of AVAILABLE_MODELS) {
    try {
      console.log(`Testing ${model.label} (${model.id})...`);
      const result = await generateQuestionSetFlow({
        documentChunk: DOCUMENT,
        numberOfQuestions: 2,
        model: model.id,
        difficulty: 'mixed',
        allowMultipleChoice: true,
        allowTrueFalse: true,
      });
      console.log(`${model.label} OK:`, JSON.stringify(result.questions, null, 2));
    } catch (e) {
      console.error(`${model.label} FAILED:`, e);
    }
  }
}

main();
