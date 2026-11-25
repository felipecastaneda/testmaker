/**
 * Load test for online exams: N students join the same assignment at once, answer every
 * question and submit, using the same server code the app runs.
 *
 *   npm run loadtest:exam                    # 200 students
 *   npm run loadtest:exam -- --students=500
 *
 * Runs ONLY against the Firestore emulator (the npm script starts one); it refuses to run
 * otherwise, so it can never touch production. The emulator doesn't reproduce production
 * latency, but it does reproduce transaction contention, which is what this is about.
 */
import { randomUUID } from "node:crypto";
import { adminDb } from "@/server/admin";
import { getExamView, joinAssignment, saveAnswer, submitAttempt } from "@/server/attempts-repo";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST isn't set. Use `npm run loadtest:exam`.");
  process.exit(1);
}

const students = Number(process.argv.find((a) => a.startsWith("--students="))?.split("=")[1] ?? 200);
const QUESTIONS = 10;

const timings: Record<string, number[]> = { join: [], save: [], submit: [] };
const errors: Record<string, Map<string, number>> = { join: new Map(), save: new Map(), submit: new Map() };

async function timed<T>(kind: keyof typeof timings, fn: () => Promise<T>): Promise<T | undefined> {
  const start = performance.now();
  try {
    return await fn();
  } catch (error) {
    const message = (error as Error).message.slice(0, 120);
    errors[kind].set(message, (errors[kind].get(message) ?? 0) + 1);
    return undefined;
  } finally {
    timings[kind].push(performance.now() - start);
  }
}

const pct = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]) : 0;
};

async function seed(): Promise<{ assignmentId: string; code: string }> {
  const db = adminDb();
  const ref = db.collection("assignments").doc();
  const code = `LT${randomUUID().replace(/[^A-HJ-NP-Z2-9]/gi, "").toUpperCase()}`.replace(/[01ILO]/g, "A").slice(0, 8).padEnd(8, "A");
  const now = new Date().toISOString();
  const batch = db.batch();
  for (let i = 0; i < QUESTIONS; i++) {
    batch.set(ref.collection("questions").doc(`q${i}`), {
      id: `q${i}`,
      question: `Question ${i}?`,
      correctAnswer: `Right ${i}`,
      distractors: [`Wrong ${i}a`, `Wrong ${i}b`, `Wrong ${i}c`],
      points: 1,
      position: i,
    });
  }
  batch.set(ref, {
    title: "Load test",
    opensAt: null,
    closesAt: null,
    timeLimitMinutes: 60,
    shuffleQuestions: true,
    resultsRelease: "immediately",
    showCorrectAnswers: true,
    orgId: "loadtest",
    courseId: "loadtest",
    testId: "loadtest",
    testVersion: 1,
    status: "open",
    joinCode: code,
    questionCount: QUESTIONS,
    totalPoints: QUESTIONS,
    maxStudents: Math.max(students, 1),
    stats: { started: 0, submitted: 0 },
    resultsReleased: false,
    createdBy: "loadtest",
    createdAt: now,
    updatedAt: now,
  });
  batch.set(db.collection("joinCodes").doc(code), { assignmentId: ref.id, createdAt: now });
  await batch.commit();
  return { assignmentId: ref.id, code };
}

async function student(code: string, n: number) {
  const joined = await timed("join", () => joinAssignment(code, `Student ${n}`, `ID-${n}`, "loadtest"));
  if (!joined) return;
  for (const q of joined.view.questions) {
    const option = q.options[Math.floor(Math.random() * q.options.length)];
    await timed("save", () => saveAnswer(joined.token, q.id, option));
  }
  await timed("submit", () => submitAttempt(joined.token));
  return joined.token;
}

async function main() {
  console.log(`Load test: ${students} students × ${QUESTIONS} questions against ${process.env.FIRESTORE_EMULATOR_HOST}\n`);
  const { assignmentId, code } = await seed();
  const started = performance.now();
  const tokens = (await Promise.all(Array.from({ length: students }, (_, i) => student(code, i)))).filter(Boolean) as string[];
  const seconds = (performance.now() - started) / 1000;

  for (const kind of Object.keys(timings) as (keyof typeof timings)[]) {
    const t = timings[kind];
    const failed = [...errors[kind].values()].reduce((a, b) => a + b, 0);
    console.log(`${kind.padEnd(7)} n=${String(t.length).padEnd(5)} p50=${pct(t, 50)}ms p95=${pct(t, 95)}ms max=${pct(t, 100)}ms failed=${failed}`);
    for (const [message, count] of errors[kind]) console.log(`          ${count}× ${message}`);
  }

  // Consistency: every student who joined has a submitted, graded attempt.
  const attempts = await adminDb().collection("assignments").doc(assignmentId).collection("attempts").get();
  const graded = attempts.docs.filter((d) => d.get("submittedAt") && d.get("grade")).length;
  const views = await Promise.all(tokens.slice(0, 5).map((t) => getExamView(t)));
  console.log(`\n${seconds.toFixed(1)}s total · ${attempts.size} attempts · ${graded} submitted and graded`);
  console.log(`sample results released: ${views.every((v) => v.result?.released) ? "yes" : "NO"}`);

  const ok = attempts.size === students && graded === students && Object.values(errors).every((m) => m.size === 0);
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
