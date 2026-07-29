import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import {openAI} from '@genkit-ai/compat-oai/openai';

export const ai = genkit({
  plugins: [
    googleAI(),
    openAI(),
  ],
});
