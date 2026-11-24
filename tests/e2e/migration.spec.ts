import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { E2E } from "../../playwright.config";
import { createVerifiedUser, readDoc, resetEmulators, writeDoc } from "./emulators";

/** Run scripts/migrate-step1.ts against the emulators (never production). */
function migrate(...args: string[]): string {
  return execSync(`npm run -s migrate:step1 -- ${args.join(" ")}`, {
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: E2E.projectId,
      FIRESTORE_EMULATOR_HOST: E2E.firestoreHost,
      FIREBASE_AUTH_EMULATOR_HOST: E2E.authHost,
      ALLOWED_EMAILS: "owner@example.com",
    },
  });
}

test("the step 1 migration gives existing owners a workspace, and is idempotent", async () => {
  await resetEmulators();
  const uid = await createVerifiedUser("owner@example.com");
  await writeDoc("tests/old_test", {
    ownerId: uid,
    name: "Old Test",
    nameKey: "old_test",
    version: 1,
    questionCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const dryRun = migrate();
  expect(dryRun).toContain("DRY RUN");
  expect(dryRun).toContain("owner@example.com: 1 test(s), 1 to move, needs a workspace");
  expect(await readDoc(`users/${uid}`)).toBeNull();
  expect(await readDoc("_meta/platform")).toBeNull();

  expect(migrate("--apply")).toContain("Done: 1 workspace(s) created, 1 test(s) moved into courses, 0 owner(s) skipped.");
  expect(await readDoc("tests/old_test")).toMatchObject({ orgId: `p_${uid}`, courseId: `p_${uid}_default` });
  expect(await readDoc(`orgs/p_${uid}/members/${uid}`)).toMatchObject({ role: "owner", orgKind: "personal" });
  expect(await readDoc(`courses/p_${uid}_default`)).toMatchObject({ orgId: `p_${uid}`, staffUids: [uid] });
  expect(await readDoc("_meta/platform")).toMatchObject({ signupMode: "allowlist", allowedEmails: ["owner@example.com"] });

  expect(migrate("--apply")).toContain("Done: 0 workspace(s) created, 0 test(s) moved into courses, 0 owner(s) skipped.");
});
