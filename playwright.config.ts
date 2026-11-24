import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real app against the Firebase Auth + Firestore emulators
 * (project "demo-testmaker": demo-* projects can never reach production) with the
 * LLM replaced by a deterministic fake (TESTMAKER_FAKE_AI, ignored in production).
 *
 * Requires Java for the emulators. Run with: npm run test:e2e
 */
export const E2E = {
  port: 3100,
  projectId: "demo-testmaker",
  authHost: "127.0.0.1:9099",
  firestoreHost: "127.0.0.1:8080",
  teacher: "teacher@example.com",
  outsider: "outsider@example.com",
  /** Also allow-listed; must never see the teacher's tests. */
  colleague: "colleague@example.com",
  /** Not allow-listed; gets in by being a member of an institution. */
  invitee: "invitee@example.com",
  password: "correct-horse-battery",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${E2E.port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `firebase emulators:exec --only auth,firestore --project ${E2E.projectId} "npx next dev -p ${E2E.port}"`,
    url: `http://localhost:${E2E.port}`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: E2E.projectId,
      NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:e2e",
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: E2E.authHost,
      FIREBASE_AUTH_EMULATOR_HOST: E2E.authHost,
      FIRESTORE_EMULATOR_HOST: E2E.firestoreHost,
      TESTMAKER_FAKE_AI: "1",
      ALLOWED_EMAILS: `${E2E.teacher},${E2E.colleague}`,
      LEGACY_OWNER_EMAIL: E2E.teacher,
      DAILY_QUESTION_LIMIT: "100",
    },
  },
});
