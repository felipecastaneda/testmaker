# Step 2: Online exams (assign, take, grade)

Status: proposal · Written 2026-11-24 · Builds on step 1 (orgs, courses, settings, points, student view)

## Goal

A professor can give a test to a class online and get grades back:

1. **Assign:** turn a test into an *assignment* with a window, time limit and attempt rules, and get
   a link / join code to share.
2. **Take:** students open the link, identify themselves, answer, and submit. Answers autosave and
   survive a closed tab. The server enforces the deadline.
3. **Grade:** the server grades on submit. The professor sees a gradebook (students × questions),
   exports CSV, and can fix a bad question and regrade everyone.

### Out of scope for step 2

Paper mode and scanning (step 3), Google/Microsoft/SSO student sign-in (step 4), open-ended
questions and AI-assisted grading (step 5), LTI/LMS (step 6), proctoring of any kind.

---

## Principles

1. **The answer key never leaves the server for a student.** Every question sent to a student goes
   through `toStudentQuestion()`. Grading happens only on the server.
2. **An assignment is a frozen snapshot.** Editing or re-versioning the test afterwards never changes
   what students see or how they're graded. Only an explicit *regrade* changes scores.
3. **Students have no TestMaker account in step 2.** They're scoped to one attempt by an *attempt
   token* (random, stored hashed). They can't read anything else, and they never pass the
   professor signup gate.
4. **Honest integrity.** We shuffle, time-limit, allow one attempt, and *log* tab switches. We don't
   claim a browser can stop cheating.
5. **Minimal student data.** Name and student ID (or whatever the identity method needs), answers,
   timestamps. Never sent to an AI model.

---

## Data model

```
assignments/{assignmentId}
  orgId, courseId, testId, testVersion, title
  status: "draft" | "open" | "closed"          // professor-controlled; plus the time window below
  opensAt?, closesAt?                           // ISO; null = open/close manually
  timeLimitMinutes?                             // null = no limit (window still applies)
  maxAttempts: 1
  shuffleQuestions: boolean                     // option order is always shuffled per attempt
  resultsRelease: "immediately" | "after_close" | "manual"
  showCorrectAnswers: boolean                   // with results: correct answers + explanations
  identity: "name_and_id"                       // registry setting later; only option in step 2
  joinCode                                      // 8 chars, unambiguous alphabet, unique among open assignments
  questionCount, totalPoints, createdBy, createdAt, updatedAt
  stats: { started, submitted }                 // counters for the list view

assignments/{id}/questions/{questionId}         // frozen copy of the test's questions + position
                                                // (server-only; includes the answer key)

assignments/{id}/attempts/{attemptId}
  tokenHash                                     // sha256 of the attempt token held by the student's browser
  studentName, studentId, studentKey            // studentKey = normalized ID, for "one attempt per student"
  startedAt, deadline                           // deadline = min(closesAt, startedAt + timeLimit)
  submittedAt?, submittedBy: "student" | "deadline" | "teacher"
  answers: { [questionId]: string }             // the option text chosen
  order: string[]                               // question order shown to this student
  grade?: { earned, possible, perQuestion: { [questionId]: { correct, points } } }
  focusLosses: number                           // tab/window switches, informational only
  userAgent (trimmed), updatedAt
```

Separate docs per attempt, so 300 students starting together don't contend on one document.

---

## Student flow (no account)

1. The professor shares `https://…/take/{joinCode}` (or the code, typed at `/take`).
2. The student enters their name and student ID. The server checks:
   - the assignment is open and inside its window
   - the student hasn't used all their attempts (by `studentKey`)
   - the per-assignment attempt cap isn't reached (abuse guard)

   It then creates the attempt and returns a random **attempt token**. The browser keeps the token
   in `localStorage`, keyed by assignment, so a refresh or a closed tab resumes the same attempt.
3. Questions come from `toStudentQuestion(q, attemptId)`, in the attempt's order.
4. **Autosave:** each answer change is sent (debounced). The server rejects writes after
   `deadline + 30s grace`.
5. **Submit:** the server grades, stores `grade`, and returns what `resultsRelease` allows.
6. **Expired attempts** are finalized lazily as `submittedBy: "deadline"` with whatever was saved:
   when the student comes back, or when the professor opens the gradebook.

Student server actions use a separate `withAttempt(token)` wrapper: no Firebase auth, no signup
gate, and every read and write is limited to that one attempt.

**Known weakness:** with name + student ID, a student could start an attempt under someone else's
ID. Mitigations: one attempt per ID (the real student notices), the professor sees duplicates and
can void an attempt, and optionally a roster (see decisions). Real identity comes with Google/SSO
in step 4.

---

## Professor flow

- **Test → "Assign":** pick a course-owned test, set the options, and create the assignment
  (snapshot of the current version). Defaults come from new settings.
- **Assignments list** per course, showing status, window, started and submitted counts.
- **Assignment page:**
  - link, join code, QR code
  - open / close now, extend the deadline (for everyone, or one student for accommodations)
  - live list of attempts
- **Gradebook:**
  - one row per student: score, % and time taken, plus per-question correct/wrong
  - question columns show % correct (simple item analysis)
  - CSV export
  - void an attempt
- **Regrade:** change a question's correct answer, accept several answers, or give everyone
  full credit. All grades are recomputed and the change is recorded on the assignment.
- **Release results** manually when `resultsRelease = "manual"`.

New settings (registry): `assignments.defaultTimeLimit`, `assignments.resultsRelease`,
`assignments.showCorrectAnswers`. Each is added in the PR that uses it.

---

## Security and privacy

- Firestore and Storage rules stay deny-all. Everything goes through server actions.
- Attempt tokens: 32 random bytes, stored only as a SHA-256 hash, sent only to the student's
  browser.
- Join is rate-limited per assignment (cap on attempts) and a join code is long enough not to be
  guessed by scanning.
- Student-facing responses are built from `toStudentQuestion` and an explicit result projection.
  A unit test checks that no answer leaks before results are released.
- **Data location:** Firestore is `nam5` (United States). Fixed at creation.
- **Backups:** point-in-time recovery (7 days) and delete protection are enabled.
- **Retention:** attempts are deleted with their assignment. A retention setting comes later.

## Capacity

- Raise App Hosting `maxInstances` from 1 (e.g. 5) before a real class uses it.
- Writes: about one per answer change per student, so a 300-student, 30-question exam is around
  10k writes. That's fine for Firestore.
- A load test script (`scripts/load-test-exam.ts`) simulates N students against the emulator.

---

## Delivery: four parts (one PR each)

| Part | Content |
|---|---|
| 1 | Data model, `assign` from a test (snapshot), assignments list and page (link, code, open/close), settings defaults. No student side yet. |
| 2 | Student side: `/take/[code]`, join with name + ID, attempt token, resume, autosave, time limit, submit, server grading. |
| 3 | Results for students (per release policy), gradebook, CSV, item %, void attempt, regrade, accommodations (per-student extension). |
| 4 | Hardening: join rate limits, focus-loss log, load test, `maxInstances`. |

---

## Decisions (2026-11-24)

1. **Student identity in step 2:** name + student ID, no roster codes. Google/SSO comes in step 4.
2. **Step 1 is merged first** (#3 → #8). Step 2 starts from an up-to-date `main`.
3. **Production safety: done.** Point-in-time recovery (7 days) and delete protection are enabled on
   `testmaker-3fa6b`.
4. **Privacy notice: not needed** for now. Data stays in `nam5` (US).
