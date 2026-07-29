import { generateMultipleChoiceQuestions } from './src/ai/flows/generate-multiple-choice-questions';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  try {
    console.log("Testing Gemini...");
    const resGemini = await generateMultipleChoiceQuestions({
      documentContent: "The mitochondria is the powerhouse of the cell.",
      numberOfQuestions: 1,
      model: "googleai/gemini-3.6-flash"
    });
    console.log("Gemini Success:", resGemini);
  } catch (e) {
    console.error("Gemini Error:", e);
  }

  try {
    console.log("Testing OpenAI...");
    const resOpenAI = await generateMultipleChoiceQuestions({
      documentContent: "The mitochondria is the powerhouse of the cell.",
      numberOfQuestions: 1,
      model: "openai/gpt-5.5"
    });
    console.log("OpenAI Success:", resOpenAI);
  } catch (e) {
    console.error("OpenAI Error:", e);
  }
}

test();
