'use server';

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, deleteDoc, collection, getDocs } from 'firebase/firestore';

export type SaveMode = 'new_version' | 'append' | 'recreate';

export async function saveTest(testName: string, questions: any[], mode: SaveMode = 'new_version') {
  try {
    // Sanitize ID
    const testId = testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const testRef = doc(db, 'tests', testId);
    const testSnap = await getDoc(testRef);

    const now = new Date().toISOString();

    if (mode === 'recreate') {
      // Overwrite completely
      const testData = {
        name: testName,
        version: 1,
        generatedAt: now,
        updatedAt: now,
        questions: questions
      };
      await setDoc(testRef, testData);
      return { success: true, id: testId, version: 1, mode: 'recreated' };
    }

    if (mode === 'append' && testSnap.exists()) {
      // Append to questions array
      await updateDoc(testRef, {
        questions: arrayUnion(...questions),
        updatedAt: now
      });
      return { success: true, id: testId, mode: 'appended' };
    } 

    // Default: 'new_version' or creation if doesn't exist
    if (testSnap.exists()) {
      const currentData = testSnap.data();
      const nextVersion = (currentData.version || 1) + 1;
      
      // For "New Version" in Firestore, we could store versions in a subcollection,
      // but to keep it simple and compatible with the current UI, we'll just 
      // replace the current set of questions and bump the version number.
      // If the user wants to see "previous" versions, we'd need a versions subcollection.
      // Given the prompt "eliminate JSON", I'll stick to a single-doc per test approach
      // for now, which is much cleaner for Firestore.
      
      await updateDoc(testRef, {
        version: nextVersion,
        questions: questions, // Replace with new questions for the new version
        updatedAt: now
      });
      return { success: true, id: testId, version: nextVersion, mode: 'version_bumped' };
    } else {
      // Initial creation
      const testData = {
        name: testName,
        version: 1,
        generatedAt: now,
        updatedAt: now,
        questions: questions
      };
      await setDoc(testRef, testData);
      return { success: true, id: testId, version: 1, mode: 'created' };
    }

  } catch (error) {
    console.error('Failed to save test to Firestore:', error);
    return { success: false, error: String(error) };
  }
}
