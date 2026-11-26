import "server-only";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let app: App | undefined;
let db: Firestore | undefined;

function getAdminApp(): App {
  if (!app) {
    // On App Hosting (and locally with `gcloud auth application-default login`)
    // credentials come from Application Default Credentials. With the emulators,
    // FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST make credentials unnecessary.
    app =
      getApps()[0] ??
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT,
      });
  }
  return app;
}

// Next.js can load this module more than once (one copy per route bundle), but
// firebase-admin returns the same Firestore instance to every copy, and settings()
// throws if called twice. Keep the configured instance on globalThis.
const shared = globalThis as typeof globalThis & { __testmakerDb?: Firestore };

export function adminDb(): Firestore {
  if (!db) {
    if (!shared.__testmakerDb) {
      const instance = getFirestore(getAdminApp());
      instance.settings({ ignoreUndefinedProperties: true });
      shared.__testmakerDb = instance;
    }
    db = shared.__testmakerDb;
  }
  return db;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

/**
 * The project's Cloud Storage bucket (server-only: storage.rules deny all browser access).
 * With the emulators, FIREBASE_STORAGE_EMULATOR_HOST points firebase-admin at the local one.
 */
export function adminBucket() {
  const name =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT}.appspot.com`;
  return getStorage(getAdminApp()).bucket(name);
}
