# TestMaker

Turn documents into multiple-choice exams. TestMaker reads your material, asks one or more LLMs
(OpenAI and/or Gemini, via [Genkit](https://genkit.dev)) to write questions and plausible
distractors, and lets you review, edit, take, grade and export the test. Tests are stored in
Firestore.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Create a `.env.local` with:

```bash
# AI providers (only the ones you enable in the navbar are needed)
OPENAI_API_KEY=...
GEMINI_API_KEY=...

# Firebase web config
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Deploy the Firestore rules after changing them (the "New Version" archive lives in a
`tests/{id}/versions` subcollection that needs its own rule):

```bash
firebase deploy --only firestore:rules
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (Next.js + TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run genkit:dev` | Genkit developer UI for the AI flows |
| `npx tsx test-models.ts` | Smoke-test both models against a one-line document |

## How it works

- **Upload** – `.txt`, `.md`, `.csv`, `.docx` and `.xlsx` are parsed in the browser
  (`src/lib/document-parser.ts`, no extra dependencies), or paste text directly.
- **Generate** – the requested question count is split across the selected models, which run in
  parallel. Each question then gets distractors from the same model (`src/ai/flows/`), with a
  concurrency cap to avoid rate limits. If one model fails, the others still produce questions.
- **Save strategies**
  - *New Version* – creates the test, or archives the current questions to
    `tests/{id}/versions/v{n}` and bumps the version.
  - *Append* – adds questions to an existing test.
  - *Re-create* – replaces an existing test and clears its archived versions.
- **Review** – edit questions/answers/distractors, delete, shuffle, take the test and grade it.
  Changes to saved tests are written back to Firestore automatically.
- **Export** – plain-text download, or a print-ready page with an answer key (save as PDF from the
  print dialog).

AI model choices live in `src/ai/models.ts`.

## Security note

`firestore.rules` and `storage.rules` currently allow unauthenticated reads and writes to tests,
which is fine for local prototyping but **not for a public deployment**. Add Firebase Auth and
restrict the rules before sharing the app.
