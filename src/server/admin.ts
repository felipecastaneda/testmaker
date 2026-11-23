import "server-only";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

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

export function adminDb(): Firestore {
  if (!db) {
    db = getFirestore(getAdminApp());
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

export function adminAuth() {
  return getAuth(getAdminApp());
}
