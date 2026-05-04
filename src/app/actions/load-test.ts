'use server';

import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, query, orderBy, deleteDoc } from 'firebase/firestore';

export async function listTests() {
  try {
    const testsRef = collection(db, 'tests');
    const q = query(testsRef, orderBy('updatedAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    const tests = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || doc.id,
        version: data.version || 1,
        createdAt: data.generatedAt || data.updatedAt,
        updatedAt: data.updatedAt,
        questionCount: data.questions?.length || 0
      };
    });

    return { success: true, tests };
  } catch (error) {
    console.error('Failed to list tests from Firestore:', error);
    return { success: false, error: String(error) };
  }
}

export async function loadTest(testId: string) {
  try {
    const testRef = doc(db, 'tests', testId);
    const testSnap = await getDoc(testRef);

    if (!testSnap.exists()) {
      throw new Error("Test not found in Firestore");
    }

    return { success: true, test: testSnap.data() };
  } catch (error) {
    console.error('Failed to load test from Firestore:', error);
    return { success: false, error: String(error) };
  }
}

export async function deleteTest(testId: string) {
  try {
    const testRef = doc(db, 'tests', testId);
    await deleteDoc(testRef);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete test from Firestore:', error);
    return { success: false, error: String(error) };
  }
}
