/**
 * Step 1 migration (organizations and courses). Safe to run more than once.
 *
 *  - Seeds _meta/platform ({ signupMode: "allowlist", allowedEmails }) from ALLOWED_EMAILS
 *    if it doesn't exist yet.
 *  - Gives every user who owns tests a personal org and a "My tests" course, and moves
 *    their tests into it.
 *
 * It only adds documents and fields, so the previous deploy keeps working on migrated
 * data. The app also does the per-user part lazily on sign-in; this script just gets it
 * done for everyone at once.
 *
 * Usage (dry run by default):
 *   npm run migrate:step1             # report what would change
 *   npm run migrate:step1 -- --apply  # make the changes
 *
 * Credentials: Application Default Credentials (`gcloud auth application-default login`)
 * against NEXT_PUBLIC_FIREBASE_PROJECT_ID from .env.local, or FIRESTORE_EMULATOR_HOST and
 * FIREBASE_AUTH_EMULATOR_HOST for the emulators. Back up first:
 *   gcloud firestore export gs://<bucket>/backups/pre-step1
 */
import { config as loadEnv } from "dotenv";
import { adminAuth, adminDb } from "@/server/admin";
import { serverConfig } from "@/server/config";
import { adoptOrphanTests, ensureUserWorkspace } from "@/server/workspace";

loadEnv({ path: ".env.local" });

const apply = process.argv.includes("--apply");

async function main() {
  const db = adminDb();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? "(default)";
  const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : "PRODUCTION";
  console.log(`${apply ? "APPLYING" : "DRY RUN"} against project ${projectId} (${target})\n`);

  // 1. Platform config
  const platformRef = db.collection("_meta").doc("platform");
  if ((await platformRef.get()).exists) {
    console.log("_meta/platform: already exists, left unchanged");
  } else {
    const allowedEmails = [...serverConfig.allowedEmails].sort();
    console.log(`_meta/platform: ${apply ? "creating" : "would create"} with signupMode "allowlist" and ${allowedEmails.length} allowed email(s)`);
    if (apply) await platformRef.create({ signupMode: "allowlist", allowedEmails, createdAt: new Date().toISOString() });
  }

  // 2. Test owners
  const tests = await db.collection("tests").select("ownerId", "courseId").get();
  const owners = new Map<string, { total: number; orphans: number }>();
  let unowned = 0;
  for (const doc of tests.docs) {
    const ownerId: unknown = doc.get("ownerId");
    if (typeof ownerId !== "string" || !ownerId) {
      unowned++;
      continue;
    }
    const entry = owners.get(ownerId) ?? { total: 0, orphans: 0 };
    entry.total++;
    if (!doc.get("courseId")) entry.orphans++;
    owners.set(ownerId, entry);
  }

  console.log(`\n${tests.size} test(s), ${owners.size} owner(s)`);
  if (unowned) {
    console.log(`${unowned} test(s) have no owner yet (pre-accounts). They go to LEGACY_OWNER_EMAIL on that user's next sign-in.`);
  }

  let workspaces = 0;
  let moved = 0;
  let skipped = 0;
  for (const [uid, { total, orphans }] of owners) {
    let email: string | undefined;
    try {
      email = (await adminAuth().getUser(uid)).email?.toLowerCase();
    } catch {
      email = undefined;
    }
    if (!email) {
      console.log(`  ${uid}: no Firebase Auth account or email; skipped (${total} test(s))`);
      skipped++;
      continue;
    }
    const hasWorkspace = (await db.collection("users").doc(uid).get()).get("workspaceVersion") === 1;
    console.log(`  ${email}: ${total} test(s), ${orphans} to move${hasWorkspace ? "" : ", needs a workspace"}`);
    if (!apply) continue;

    const workspace = await ensureUserWorkspace({ uid, email });
    if (!hasWorkspace) workspaces++;
    // ensureUserWorkspace only adopts tests when it first creates the workspace.
    await adoptOrphanTests(uid, workspace.personalOrgId, workspace.defaultCourseId);
    moved += orphans - (await countOrphans(uid));
  }

  console.log(
    apply
      ? `\nDone: ${workspaces} workspace(s) created, ${moved} test(s) moved into courses, ${skipped} owner(s) skipped.`
      : "\nNothing was changed. Re-run with --apply to migrate."
  );
}

async function countOrphans(uid: string): Promise<number> {
  const owned = await adminDb().collection("tests").where("ownerId", "==", uid).select("courseId").get();
  return owned.docs.filter((d) => !d.get("courseId")).length;
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
