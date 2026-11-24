import "server-only";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { requireCourseAccess } from "./workspace";
import type {
  CourseAccessNeed,
  QuestionData,
  SaveMode,
  SaveTestOutcome,
  StoredTest,
  TestSummary,
  TestVersionSummary,
} from "@/lib/types";

/*
 * Data model
 *   tests/{testId}                              { ownerId, orgId, courseId, name, nameKey, version, generatedAt, updatedAt, questionCount }
 *   tests/{testId}/questions/{questionId}       QuestionData + { position }
 *   tests/{testId}/versions/v{n}               { version, archivedAt, generatedAt, questionCount }
 *   tests/{testId}/versions/v{n}/questions/{id} QuestionData + { position }
 *
 * Questions live in a subcollection so a test isn't capped by Firestore's 1 MB document
 * limit, and so editing one question never rewrites (or races with) the others.
 *
 * Access is decided by the test's course (see workspace.ts); ownerId records who created it.
 * Names are unique per course.
 *
 * Legacy documents (pre-accounts) have no ownerId and keep questions in an array field;
 * migrateLegacyTests() converts them. Tests from before organizations have no courseId;
 * ensureUserWorkspace() moves them into their owner's default course.
 */

const TESTS = "tests";
const QUESTIONS = "questions";
const VERSIONS = "versions";

/** Name → lookup key. Must stay stable: legacy document ids were derived the same way. */
export function toNameKey(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

type StoredQuestion = QuestionData & { position: number };

function toStored(q: QuestionData, position: number): StoredQuestion {
  return {
    id: q.id,
    question: q.question,
    correctAnswer: q.correctAnswer,
    distractors: q.distractors ?? [],
    type: q.type,
    difficulty: q.difficulty,
    explanation: q.explanation,
    sourceQuote: q.sourceQuote,
    imageUrl: q.imageUrl,
    sourceModel: q.sourceModel,
    position,
  };
}

function fromStored(data: FirebaseFirestore.DocumentData): QuestionData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { position, ...question } = data;
  return question as QuestionData;
}

/** Firestore ids can't contain "/" and are limited in length. */
function safeQuestionId(id: string, fallbackIndex: number): string {
  const cleaned = id.replace(/\//g, "_").slice(0, 200);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : `q${fallbackIndex}`;
}

async function writeQuestions(db: Firestore, parent: DocumentReference, questions: QuestionData[], startPosition = 0) {
  const writer = db.bulkWriter();
  questions.forEach((q, i) => {
    const id = safeQuestionId(q.id, startPosition + i);
    writer.set(parent.collection(QUESTIONS).doc(id), toStored({ ...q, id }, startPosition + i));
  });
  await writer.close();
}

async function readQuestions(parent: DocumentReference): Promise<QuestionData[]> {
  const snap = await parent.collection(QUESTIONS).orderBy("position").get();
  return snap.docs.map((d) => fromStored(d.data()));
}

const TEST_NOT_FOUND = "Test not found.";

async function getTestRef(user: AuthedUser, testId: string, need: CourseAccessNeed): Promise<DocumentReference> {
  if (typeof testId !== "string" || !testId || testId.includes("/")) throw new UserFacingError(TEST_NOT_FOUND);
  const ref = adminDb().collection(TESTS).doc(testId);
  const snap = await ref.get();
  // Same message for "missing" and "not yours" so ids can't be probed.
  if (!snap.exists) throw new UserFacingError(TEST_NOT_FOUND);
  await requireCourseAccess(user, snap.get("courseId"), need, TEST_NOT_FOUND);
  return ref;
}

async function findByName(courseId: string, name: string) {
  const snap = await adminDb()
    .collection(TESTS)
    .where("courseId", "==", courseId)
    .where("nameKey", "==", toNameKey(name))
    .limit(1)
    .get();
  return snap.docs[0];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Firestore "in" queries accept at most 30 values. */
const IN_LIMIT = 30;

export async function listTests(courseIds: string[]): Promise<TestSummary[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < courseIds.length; i += IN_LIMIT) chunks.push(courseIds.slice(i, i + IN_LIMIT));
  const snaps = await Promise.all(chunks.map((ids) => adminDb().collection(TESTS).where("courseId", "in", ids).get()));
  return snaps
    .flatMap((snap) => snap.docs)
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || d.id,
        version: data.version || 1,
        createdAt: data.generatedAt || data.updatedAt,
        updatedAt: data.updatedAt,
        questionCount: data.questionCount ?? 0,
      };
    })
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export async function loadTest(user: AuthedUser, testId: string): Promise<StoredTest> {
  const ref = await getTestRef(user, testId, "view");
  const [snap, questions] = await Promise.all([ref.get(), readQuestions(ref)]);
  const data = snap.data()!;
  return {
    id: ref.id,
    name: data.name,
    version: data.version || 1,
    generatedAt: data.generatedAt,
    updatedAt: data.updatedAt,
    questions,
  };
}

export async function listVersions(user: AuthedUser, testId: string): Promise<TestVersionSummary[]> {
  const ref = await getTestRef(user, testId, "view");
  const snap = await ref.collection(VERSIONS).orderBy("version", "desc").get();
  return snap.docs.map((d) => ({
    version: d.get("version"),
    archivedAt: d.get("archivedAt"),
    questionCount: d.get("questionCount") ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Move the test's current questions into versions/v{n} and replace them with `questions`. */
async function replaceWithNewVersion(ref: DocumentReference, questions: QuestionData[], now: string): Promise<number> {
  const db = adminDb();
  const snap = await ref.get();
  const currentVersion: number = snap.get("version") ?? 1;
  const current = await readQuestions(ref);

  const versionRef = ref.collection(VERSIONS).doc(`v${currentVersion}`);
  // If an archive for this number already exists (shouldn't happen), replace it cleanly.
  await db.recursiveDelete(versionRef);
  await versionRef.set({
    version: currentVersion,
    archivedAt: now,
    generatedAt: snap.get("generatedAt") ?? null,
    questionCount: current.length,
  });
  await writeQuestions(db, versionRef, current);

  await db.recursiveDelete(ref.collection(QUESTIONS));
  await writeQuestions(db, ref, questions);
  const nextVersion = currentVersion + 1;
  await ref.update({ version: nextVersion, questionCount: questions.length, updatedAt: now });
  return nextVersion;
}

export async function saveTest(
  user: AuthedUser,
  courseId: string,
  rawName: string,
  questions: QuestionData[],
  mode: SaveMode
): Promise<SaveTestOutcome> {
  const db = adminDb();
  const name = rawName.trim();
  if (!/[a-z0-9]/i.test(name)) throw new UserFacingError("Please give the test a name containing letters or numbers.");
  const { orgId } = await requireCourseAccess(user, courseId, "edit");
  const now = new Date().toISOString();
  const existing = await findByName(courseId, name);

  const create = async (): Promise<SaveTestOutcome> => {
    const ref = db.collection(TESTS).doc();
    await ref.set({
      ownerId: user.uid,
      orgId,
      courseId,
      name,
      nameKey: toNameKey(name),
      version: 1,
      generatedAt: now,
      updatedAt: now,
      questionCount: questions.length,
    });
    await writeQuestions(db, ref, questions);
    return { id: ref.id, name, version: 1, mode: "created" };
  };

  if (!existing) {
    if (mode === "append" || mode === "recreate") {
      throw new UserFacingError(`There's no saved test called "${name}".`);
    }
    return create();
  }

  const ref = existing.ref;
  const existingName: string = existing.get("name");

  if (mode === "recreate") {
    await db.recursiveDelete(ref.collection(QUESTIONS));
    await db.recursiveDelete(ref.collection(VERSIONS));
    await ref.update({ version: 1, generatedAt: now, updatedAt: now, questionCount: questions.length });
    await writeQuestions(db, ref, questions);
    return { id: ref.id, name: existingName, version: 1, mode: "recreated" };
  }

  if (mode === "append") {
    const last = await ref.collection(QUESTIONS).orderBy("position", "desc").limit(1).get();
    const start = last.empty ? 0 : (last.docs[0].get("position") as number) + 1;
    await writeQuestions(db, ref, questions, start);
    await ref.update({ questionCount: FieldValue.increment(questions.length), updatedAt: now });
    return { id: ref.id, name: existingName, version: existing.get("version") ?? 1, mode: "appended" };
  }

  const version = await replaceWithNewVersion(ref, questions, now);
  return { id: ref.id, name: existingName, version, mode: "version_bumped" };
}

export async function updateQuestion(user: AuthedUser, testId: string, question: QuestionData): Promise<void> {
  const ref = await getTestRef(user, testId, "edit");
  const qRef = ref.collection(QUESTIONS).doc(safeQuestionId(question.id, 0));
  const existing = await qRef.get();
  if (!existing.exists) throw new UserFacingError("That question no longer exists.");
  // set() (not merge) so cleared optional fields such as imageUrl are actually removed.
  await qRef.set(toStored(question, existing.get("position")));
  await ref.update({ updatedAt: new Date().toISOString() });
}

export async function deleteQuestion(user: AuthedUser, testId: string, questionId: string): Promise<void> {
  const ref = await getTestRef(user, testId, "edit");
  const qRef = ref.collection(QUESTIONS).doc(safeQuestionId(questionId, 0));
  if (!(await qRef.get()).exists) return;
  await qRef.delete();
  await ref.update({ questionCount: FieldValue.increment(-1), updatedAt: new Date().toISOString() });
}

export async function reorderQuestions(user: AuthedUser, testId: string, orderedIds: string[]): Promise<void> {
  const db = adminDb();
  const ref = await getTestRef(user, testId, "edit");
  const snap = await ref.collection(QUESTIONS).select().get();
  const existingIds = new Set(snap.docs.map((d) => d.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new UserFacingError("The test changed in another window. Reload it and try again.");
  }
  const writer = db.bulkWriter();
  orderedIds.forEach((id, position) => writer.update(ref.collection(QUESTIONS).doc(id), { position }));
  await writer.close();
  await ref.update({ updatedAt: new Date().toISOString() });
}

export async function restoreVersion(user: AuthedUser, testId: string, version: number): Promise<number> {
  const ref = await getTestRef(user, testId, "edit");
  const versionRef = ref.collection(VERSIONS).doc(`v${version}`);
  if (!(await versionRef.get()).exists) throw new UserFacingError(`Version ${version} wasn't found.`);
  const questions = await readQuestions(versionRef);
  return replaceWithNewVersion(ref, questions, new Date().toISOString());
}

export async function deleteTest(user: AuthedUser, testId: string): Promise<void> {
  const ref = await getTestRef(user, testId, "edit");
  await adminDb().recursiveDelete(ref);
}

// ---------------------------------------------------------------------------
// Usage quota
// ---------------------------------------------------------------------------

/** Atomically reserve `count` questions from the user's daily allowance. */
export async function reserveDailyQuota(ownerId: string, count: number, limit: number): Promise<void> {
  const db = adminDb();
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection("usage").doc(`${ownerId}_${day}`);
  await db.runTransaction(async (tx) => {
    const used: number = (await tx.get(ref)).get("questions") ?? 0;
    if (used + count > limit) {
      throw new UserFacingError(
        `Daily limit reached: ${used} of ${limit} questions used today. Try a smaller test or come back tomorrow.`
      );
    }
    tx.set(ref, { ownerId, day, questions: used + count, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

/** Give back a reservation when generation failed, so users aren't charged for errors. */
export async function releaseDailyQuota(ownerId: string, count: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await adminDb()
    .collection("usage")
    .doc(`${ownerId}_${day}`)
    .set({ questions: FieldValue.increment(-count) }, { merge: true });
}

export async function getDailyUsage(ownerId: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const snap = await adminDb().collection("usage").doc(`${ownerId}_${day}`).get();
  return Math.max(0, snap.get("questions") ?? 0);
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

/**
 * Give tests created before accounts existed to `ownerId` (in course `placement`),
 * converting their inline `questions` arrays (and those of archived versions) to
 * subcollections. Idempotent.
 */
export async function migrateLegacyTests(
  ownerId: string,
  placement: { orgId: string; courseId: string }
): Promise<number> {
  const db = adminDb();
  const marker = db.collection("_meta").doc("legacyMigration");
  if ((await marker.get()).get("done")) return 0;

  const all = await db.collection(TESTS).get();
  let migrated = 0;
  for (const doc of all.docs) {
    if (doc.get("ownerId")) continue;
    const data = doc.data();
    const questions: QuestionData[] = Array.isArray(data.questions) ? data.questions : [];

    await writeQuestions(db, doc.ref, questions);

    const versions = await doc.ref.collection(VERSIONS).get();
    for (const v of versions.docs) {
      const vQuestions: unknown = v.get("questions");
      if (Array.isArray(vQuestions)) {
        await writeQuestions(db, v.ref, vQuestions as QuestionData[]);
        await v.ref.update({ questions: FieldValue.delete(), questionCount: vQuestions.length });
      }
    }

    const name: string = data.name || doc.id;
    await doc.ref.update({
      ownerId,
      orgId: placement.orgId,
      courseId: placement.courseId,
      name,
      nameKey: toNameKey(name),
      questionCount: questions.length,
      updatedAt: data.updatedAt || data.generatedAt || new Date().toISOString(),
      questions: FieldValue.delete(),
    });
    migrated++;
  }

  await marker.set({ done: true, ownerId, migrated, at: new Date().toISOString() });
  return migrated;
}
