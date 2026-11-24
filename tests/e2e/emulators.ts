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

type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };
type FirestoreValue = Record<string, unknown>;

function encode(value: Plain): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: encodeFields(value) } };
}

function encodeFields(obj: { [key: string]: Plain }) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encode(v)]));
}

function decode(value: FirestoreValue): Plain {
  if ("stringValue" in value) return value.stringValue as string;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue as number;
  if ("booleanValue" in value) return value.booleanValue as boolean;
  if ("arrayValue" in value) return ((value.arrayValue as { values?: FirestoreValue[] }).values ?? []).map(decode);
  if ("mapValue" in value) return decodeFields((value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {});
  return null;
}

function decodeFields(fields: Record<string, FirestoreValue>) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));
}

/** Write a document with admin rights. `path` is like "orgs/abc/members/uid". */
export async function writeDoc(path: string, data: { [key: string]: Plain }) {
  const res = await fetch(`${FIRESTORE}/${path}`, {
    method: "PATCH",
    headers: OWNER,
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!res.ok) throw new Error(`Writing ${path} failed: ${res.status} ${await res.text()}`);
}

/** Read a document with admin rights; null when it doesn't exist. */
export async function readDoc(path: string): Promise<{ [key: string]: Plain } | null> {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: OWNER });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Reading ${path} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  return decodeFields(body.fields ?? {});
}

/** The Auth emulator uid for `email`. */
export async function getUid(email: string): Promise<string> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${E2E.projectId}/accounts:lookup`, {
    method: "POST",
    headers: OWNER,
    body: JSON.stringify({ email: [email] }),
  });
  const body = (await res.json()) as { users?: { localId: string }[] };
  const uid = body.users?.[0]?.localId;
  if (!uid) throw new Error(`No auth user for ${email}`);
  return uid;
}

/** Create a verified account directly in the Auth emulator (no browser). Returns its uid. */
export async function createVerifiedUser(email: string): Promise<string> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: E2E.password, returnSecureToken: true }),
  });
  const { localId } = (await res.json()) as { localId: string };
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${E2E.projectId}/accounts:update`, {
    method: "POST",
    headers: OWNER,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  return localId;
}
