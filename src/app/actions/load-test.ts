'use server';

import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, query, orderBy, deleteDoc, writeBatch } from 'firebase/firestore';
import type { QuestionData, StoredTest, TestSummary } from '@/lib/types';

export async function listTests(): Promise<{ success: boolean; tests?: TestSummary[]; error?: string }> {
  try {
    const q = query(collection(db, 'tests'), orderBy('updatedAt', 'desc'));
    const querySnapshot = await getDocs(q);

    const tests: TestSummary[] = querySnapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || d.id,
        version: data.version || 1,
        createdAt: data.generatedAt || data.updatedAt,
        updatedAt: data.updatedAt,
        questionCount: data.questions?.length || 0,
      };
    });

    return { success: true, tests };
  } catch (error) {
    console.error('Failed to list tests from Firestore:', error);
    return { success: false, error: String(error) };
  }
}

export async function loadTest(testId: string): Promise<{ success: boolean; test?: StoredTest; error?: string }> {
  try {
    const testSnap = await getDoc(doc(db, 'tests', testId));
    if (!testSnap.exists()) {
      return { success: false, error: 'Test not found.' };
    }

    const data = testSnap.data();
    return {
      success: true,
      test: {
        id: testSnap.id,
        name: data.name || testSnap.id,
        version: data.version || 1,
        generatedAt: data.generatedAt || data.updatedAt,
        updatedAt: data.updatedAt,
        questions: (data.questions ?? []) as QuestionData[],
      },
    };
  } catch (error) {
    console.error('Failed to load test from Firestore:', error);
    return { success: false, error: String(error) };
  }
}

export async function deleteTest(testId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Remove archived versions first so they don't linger as orphans.
    try {
      const versions = await getDocs(collection(db, 'tests', testId, 'versions'));
      if (!versions.empty) {
        const batch = writeBatch(db);
        versions.docs.forEach((v) => batch.delete(v.ref));
        await batch.commit();
      }
    } catch (error) {
      console.warn('Could not delete version history:', error);
    }

    await deleteDoc(doc(db, 'tests', testId));
    return { success: true };
  } catch (error) {
    console.error('Failed to delete test from Firestore:', error);
    return { success: false, error: String(error) };
  }
}
