import { E2E } from "../../playwright.config";

const AUTH = `http://${E2E.authHost}`;
const FIRESTORE = `http://${E2E.firestoreHost}/v1/projects/${E2E.projectId}/databases/(default)/documents`;
// The emulators accept this token as an all-powerful admin that bypasses security rules.
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

export async function resetEmulators() {
  await fetch(`${AUTH}/emulator/v1/projects/${E2E.projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://${E2E.firestoreHost}/emulator/v1/projects/${E2E.projectId}/databases/(default)/documents`, {
    method: "DELETE",
  });
}

/** Follow the most recent email-verification link the emulator "sent" to `email`. */
export async function verifyEmail(email: string) {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${E2E.projectId}/oobCodes`);
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] };
  const code = oobCodes.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL").pop();
  if (!code) throw new Error(`No verification email for ${email}`);
  const apply = await fetch(code.oobLink);
  if (!apply.ok) throw new Error(`Verification failed: ${apply.status}`);
}

/** Insert a pre-accounts test exactly as the old app stored it (no owner, inline questions). */
export async function seedLegacyTest() {
  const q = (id: string, question: string, answer: string, distractors: string[]) => ({
    mapValue: {
      fields: {
        id: { stringValue: id },
        question: { stringValue: question },
        correctAnswer: { stringValue: answer },
        distractors: { arrayValue: { values: distractors.map((d) => ({ stringValue: d })) } },
        sourceModel: { stringValue: "openai/gpt-4o" },
      },
    },
  });
  const res = await fetch(`${FIRESTORE}/tests?documentId=legacy_study_guide`, {
    method: "POST",
    headers: OWNER,
    body: JSON.stringify({
      fields: {
        name: { stringValue: "Legacy Study Guide" },
        version: { integerValue: "1" },
        generatedAt: { stringValue: "2026-05-03T15:49:54.390Z" },
        updatedAt: { stringValue: "2026-05-03T15:49:54.390Z" },
        questions: {
          arrayValue: {
            values: [
              q("old1", "What directory does the App Router use?", "app/", ["pages/", "components/", "src/"]),
              q("old2", "What is the default component type in the App Router?", "Server Component", ["Client Component", "Layout", "Page"]),
            ],
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Seeding failed: ${res.status} ${await res.text()}`);
}

/** Read a collection the way a browser would: without admin credentials. */
export async function unauthenticatedRead(path: string) {
  return fetch(`${FIRESTORE}/${path}`);
}
