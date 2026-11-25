# TestMaker

Turn documents into exams. TestMaker reads your material, asks one or more LLMs (OpenAI
and/or Gemini, via [Genkit](https://genkit.dev)) to write multiple-choice and true/false
questions with distractors, explanations and supporting quotes, and lets you review, edit,
take, grade, version and export the test.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Create a `.env.local`:

```bash
# Firebase web config (same values as apphosting.yaml)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# AI providers
OPENAI_API_KEY=...
GOOGLE_GENAI_API_KEY=...

# Access control
ALLOWED_EMAILS=you@example.com,colleague@example.com
PLATFORM_ADMIN_EMAILS=you@example.com  # Settings → Platform; can create institutions
LEGACY_OWNER_EMAIL=you@example.com   # receives tests created before accounts existed
DAILY_QUESTION_LIMIT=300             # per user, optional
```

The server talks to Firestore with `firebase-admin`, which locally uses Application Default
Credentials: run `gcloud auth application-default login` once.

## Access control

- Users sign in with email and password and must **verify their email**.
- A verified user gets in if **any** of these is true; everyone else sees "No access":
  - their email is in `ALLOWED_EMAILS`
  - their email is in `_meta/platform.allowedEmails` in Firestore, or `_meta/platform.signupMode` is `"open"`
  - they are a member of an *institution* organization (i.e. someone invited them)
  - their email is in `PLATFORM_ADMIN_EMAILS`
- On first sign-in every user gets a **personal organization** with one course, "My tests".
  Tests belong to a course, and access to a test is decided by the course: organization
  owners and admins see every course in their organization; instructors and assistants see
  the courses they are staff on. Rules live in `src/lib/permissions.ts`.
- Every server action verifies the Firebase ID token, the signup gate and course access.
  The only exceptions are viewing and accepting an invite, which need just a verified
  email (`withVerifiedUser`), because joining an institution is what grants access.
- **Institutions** are created by platform admins (or anyone, once signup is `open`).
  Owners and admins invite people from Settings → Members: the app shows a one-time link
  (`/invite/<token>`) to send yourself. It works only for the invited email, once, for
  14 days; Firestore stores only a hash of the token. Admins can't create, change or
  remove owners, and an organization always keeps at least one owner. Course staff
  (instructors, assistants) are managed in Settings → Courses.
- With several organizations, the navbar's organization switcher picks which one the
  library and generate form show; the choice is remembered.
- Each user can generate at most `DAILY_QUESTION_LIMIT` questions per day (UTC). Failed
  generations are refunded.
- Firestore and Storage security rules deny all browser access; only the server reads data.

In production the allow-list lives in App Hosting secrets (the repo is public):

```bash
firebase apphosting:secrets:set allowed_emails        # comma-separated emails
firebase apphosting:secrets:set legacy_owner_email
firebase apphosting:secrets:set platform_admin_emails  # comma-separated emails
```

Changing a secret takes effect on the next rollout (push to `main`, or
`firebase apphosting:rollouts:create testmaker --git-branch main`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright + Firebase emulators, needs Java) |
| `npm run emulators` | Start the Auth and Firestore emulators |
| `npm run genkit:dev` | Genkit developer UI for the AI flow |
| `npx tsx test-models.ts` | Smoke-test each configured model with real API keys |
| `npm run migrate:step1 -- --project=<id>` | Organizations migration (dry run; add `--apply`) |

The end-to-end suite runs against a `demo-testmaker` emulator project with a deterministic
fake LLM (`TESTMAKER_FAKE_AI=1`, ignored when `NODE_ENV=production`), so it never touches
production data or spends API credits. First run: `npx playwright install chromium`.

## How it works

- **Upload**: PDF, `.pptx`, `.docx`, `.xlsx`, `.txt`, `.md` and `.csv` are parsed in the
  browser (`src/lib/document-parser.ts`), or paste text directly (max 400k characters).
  PowerPoint slides are read in presentation order with their speaker notes and marked
  `--- Slide N ---`; PDFs are read with pdf.js (loaded only when a PDF is picked) and
  marked `--- Page N ---`. Scanned PDFs (images, no text) get a clear message: text
  recognition isn't supported yet.
- **Generate**:
  - The document is split into ~40k-character chunks.
  - Questions are spread across chunks by length and across the selected models.
  - Each batch is one call to `generateQuestionBatch` (`src/app/actions/generate.ts`), which
    validates the request and checks the quota. It then runs a single Genkit prompt
    (`src/ai/flows/generate-question-set.ts`) that writes question, answer, distractors,
    explanation and a verbatim source quote together.
  - Output is cleaned in `src/ai/normalize.ts`: bad options are dropped and quotes that
    aren't really in the document are discarded.
  - Near-duplicate questions from different models are removed (`src/lib/generation.ts`).
- **Save strategies**
  - *New Version*: creates the test, or archives the current questions and bumps the version.
  - *Append*: adds questions to an existing test.
  - *Re-create*: replaces a test and clears its history.
- **Courses**: the library groups tests by course. Create, rename, archive and delete
  courses (a course must be empty to delete it; the personal "My tests" course can't be
  removed), choose the course when generating, and move tests between courses with their
  history.
- **Settings** (`/settings`): your preferred AI models; organization settings (name,
  allowed AI models, default difficulty, AI instructions, whether instructors can create
  courses, whether assistants can edit) with **locks** that stop courses from overriding a
  setting; and per-course overrides. Every setting is defined once in
  `src/lib/settings/registry.ts` and resolved as *default → organization → course*
  (`src/lib/settings/resolve.ts`). The server enforces them: generation rejects models
  the organization hasn't enabled and adds the organization's and course's instructions
  to the prompt.
- **Points and tags**: every question is worth points (default 1; new questions get the
  course's *Default points per question* setting) and has topic tags (the AI suggests 1–3;
  edit them freely). The review header shows the total, *Take test* scores by points, and
  print/Word/text exports show each question's points and the total. GIFT and Aiken have
  no per-question mark, so set points in Moodle.
- **Student view** (`src/lib/student-view.ts`): `toStudentQuestion()` strips the answer,
  explanation, quote, tags, difficulty and model. Anything sent to students must use it.
- **Assignments (online exams)**: from a saved test choose *Assign online*. The assignment is a
  frozen copy of the test's current questions (later edits don't change it), with an optional
  window (opens/closes), time limit, question shuffling, and when students see results.
  Each gets a join link and an 8-character code (no 0/O/1/I/L). Manage them under
  *Assignments* in the navbar. Course/organization settings set the defaults. Students
  take them at `/take/<code>` (or type the code at `/take`).
- **Taking an exam (students, no account)**: name + student ID, one attempt per ID
  (compared ignoring case and spaces). The browser keeps a secret attempt token
  (`<assignment>.<attempt>.<secret>`; only a hash of the secret is stored), so a refresh or a
  closed tab resumes the attempt on that device. Answers autosave; the server rejects them
  after the deadline (+30 s grace) or once the exam is closed, and then submits what was
  saved. Grading happens on the server; students see their score (and, if allowed, correct
  answers and explanations) according to the assignment's results policy. Student actions
  (`src/app/actions/take.ts`) never use Firebase Auth or the professor signup gate, and
  only ever touch the one assignment or attempt they name.
- **Gradebook** (on each assignment page): one row per student with status, score, % and time,
  and per question ✓/✗/– plus the % of students who got it right. Professors can:
  - **regrade** a question (accept extra options, or give everyone full credit); all
    submitted grades are recalculated and the change is logged on the assignment;
  - give a student **extra time** (it outlasts the closing time, but not *Close now*);
  - **reset** an attempt so the student can start again (switched device, or someone used
    their ID);
  - **release or hide results**;
  - **export CSV** (UTF-8 with BOM for Excel; formula-like text is neutralised).
  Opening the gradebook submits attempts whose time is up.
- **Review**:
  - *Edit & review* mode shows the answer key, explanations and quotes. Edits, deletes and
    re-ordering are saved per question.
  - *Take test* mode hides the answers until you submit.
  - *History* lists archived versions and restores any of them. The current version is
    archived first, so nothing is lost.
- **Export**:
  - Print/PDF, Word (.docx) and plain text, each with up to four shuffled versions (A–D)
    and an answer key per version.
  - Moodle GIFT and Aiken formats for LMS import.

### Data model

```
users/{uid}                                  email, personalOrgId, defaultCourseId, …
orgs/{orgId}                                 name, kind ("personal" | "institution"), settings
orgs/{orgId}/members/{uid}                   uid, email, orgKind, role (owner | admin | instructor | assistant)
courses/{courseId}                           orgId, name, staff {uid: role}, staffUids, settings
tests/{testId}                               ownerId, orgId, courseId, name, nameKey, version, questionCount, …
tests/{testId}/questions/{questionId}        question fields + position
tests/{testId}/versions/v{n}                 archived version metadata
tests/{testId}/versions/v{n}/questions/{id}  archived questions
invites/{sha256(token)}                      orgId, email, role, expiresAt, acceptedAt?, revokedAt?
usage/{uid}_{yyyy-mm-dd}                     daily question count
assignments/{id}                             options, status, joinCode, testVersion, stats, ...
assignments/{id}/questions/{qid}             frozen questions (incl. answer key; server-only)
assignments/{id}/attempts/{attemptId}        tokenHash, student name/ID, deadline, order, answers, grade
joinCodes/{code}                             assignmentId
_meta/platform                               signupMode, allowedEmails
```

Questions live in subcollections, so tests aren't limited by Firestore's 1 MB document size,
and editing one question never overwrites another.

Deploy rule and index changes with `firebase deploy --only firestore:rules,firestore:indexes,storage`.

### Migrating to organizations (step 1)

Existing data needs personal organizations and courses. The app creates them lazily on each
user's next sign-in, but you can migrate everyone at once. Run this **before** deploying,
after deploying the indexes:

```bash
gcloud firestore export gs://<bucket>/backups/pre-step1   # backup
npm run migrate:step1 -- --project=testmaker-3fa6b            # dry run: shows what would change
npm run migrate:step1 -- --project=testmaker-3fa6b --apply
```

The script only adds documents and fields, and running it again does nothing new.
See [docs/plans/step-1-foundation.md](docs/plans/step-1-foundation.md) for the full plan.
