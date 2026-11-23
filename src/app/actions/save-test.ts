'use server';

import { db } from '@/lib/firebase';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { QuestionData, SaveMode } from '@/lib/types';

export type { SaveMode };

type SaveOutcome = 'created' | 'appended' | 'version_bumped' | 'recreated';

export interface SaveTestResult {
  success: boolean;
  id?: string;
  version?: number;
  mode?: SaveOutcome;
  /** Set when the previous version could not be archived (e.g. Firestore rules not deployed). */
  warning?: string;
  error?: string;
}

/** Must stay stable: existing documents are keyed by this exact transformation. */
function toTestId(testName: string): string {
  return testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/** Firestore rejects `undefined` field values, so strip them before writing. */
function sanitizeQuestions(questions: QuestionData[]): QuestionData[] {
  return questions.map((q) => {
    const clean: QuestionData = {
      id: q.id,
      question: q.question,
      correctAnswer: q.correctAnswer,
      distractors: q.distractors ?? [],
    };
    if (q.imageUrl) clean.imageUrl = q.imageUrl;
    if (q.sourceModel) clean.sourceModel = q.sourceModel;
    return clean;
  });
}

async function deleteVersionHistory(testId: string) {
  const snapshot = await getDocs(collection(db, 'tests', testId, 'versions'));
  if (snapshot.empty) return;
  const batch = writeBatch(db);
  snapshot.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function saveTest(
  testName: string,
  rawQuestions: QuestionData[],
  mode: SaveMode = 'new_version'
): Promise<SaveTestResult> {
  try {
    const name = testName.trim();
    const testId = toTestId(name);
    if (!/[a-z0-9]/.test(testId)) {
      return { success: false, error: 'Please give the test a name containing letters or numbers.' };
    }

    const questions = sanitizeQuestions(rawQuestions);
    const testRef = doc(db, 'tests', testId);
    const testSnap = await getDoc(testRef);
    const now = new Date().toISOString();

    if (mode === 'recreate') {
      let warning: string | undefined;
      try {
        await deleteVersionHistory(testId);
      } catch (error) {
        console.warn('Could not clear version history:', error);
        warning = 'Older archived versions could not be removed.';
      }
      await setDoc(testRef, { name, version: 1, generatedAt: now, updatedAt: now, questions });
      return { success: true, id: testId, version: 1, mode: 'recreated', warning };
    }

    if (mode === 'append' && testSnap.exists()) {
      await updateDoc(testRef, { questions: arrayUnion(...questions), updatedAt: now });
      return { success: true, id: testId, version: testSnap.data().version ?? 1, mode: 'appended' };
    }

    if (testSnap.exists()) {
      const current = testSnap.data();
      const currentVersion: number = current.version ?? 1;
      const nextVersion = currentVersion + 1;

      // Archive the outgoing version so "New Version" never destroys earlier work.
      let warning: string | undefined;
      try {
        await setDoc(doc(db, 'tests', testId, 'versions', `v${currentVersion}`), {
          version: currentVersion,
          archivedAt: now,
          generatedAt: current.generatedAt ?? null,
          questions: current.questions ?? [],
        });
      } catch (error) {
        console.warn('Could not archive previous version:', error);
        warning = `Version ${currentVersion} could not be archived; check that the latest firestore.rules are deployed.`;
      }

      await updateDoc(testRef, { version: nextVersion, questions, updatedAt: now });
      return { success: true, id: testId, version: nextVersion, mode: 'version_bumped', warning };
    }

    await setDoc(testRef, { name, version: 1, generatedAt: now, updatedAt: now, questions });
    return { success: true, id: testId, version: 1, mode: 'created' };
  } catch (error) {
    console.error('Failed to save test to Firestore:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Persist edits (text changes, deletions, re-ordering) to an existing test
 * without bumping its version or resetting its creation date.
 */
export async function updateTestQuestions(
  testId: string,
  rawQuestions: QuestionData[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!testId) return { success: false, error: 'Missing test id.' };
    await updateDoc(doc(db, 'tests', testId), {
      questions: sanitizeQuestions(rawQuestions),
      updatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to update test questions:', error);
    return { success: false, error: String(error) };
  }
}
