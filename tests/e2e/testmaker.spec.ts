import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { E2E } from "../../playwright.config";
import { getUid, readDoc, resetEmulators, seedLegacyTest, unauthenticatedRead, verifyEmail, writeDoc } from "./emulators";

const STUDY_TEXT = [
  "The mitochondria is the powerhouse of the cell and produces most of its ATP.",
  "Photosynthesis takes place in the chloroplasts of plant cells.",
  "Ribosomes are the molecular machines that assemble proteins from amino acids.",
  "The nucleus stores the genetic material of eukaryotic cells inside a double membrane.",
  "The Golgi apparatus modifies, sorts and packages proteins for secretion.",
  "Lysosomes contain digestive enzymes that break down waste materials.",
  "The cell membrane is a phospholipid bilayer that controls what enters the cell.",
  "The cytoskeleton gives the cell its shape and helps it move.",
  "Vacuoles in plant cells store water and help maintain turgor pressure.",
  "The endoplasmic reticulum is a network of membranes involved in protein and lipid synthesis.",
].join(" ");

async function signUp(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await verifyEmail(email);
  await page.getByRole("button", { name: "I've verified my email" }).click();
}

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function generate(page: Page, name: string, count: number, course?: string) {
  await page.getByRole("button", { name: "Create New Test" }).click();
  if (course) await page.getByLabel("Course", { exact: true }).selectOption({ label: course });
  await page.getByLabel("Test Name").fill(name);
  await page.getByLabel("Number of questions").fill(String(count));
  await page.getByLabel("Or Paste Content Directly").fill(STUDY_TEXT);
  await page.getByRole("button", { name: "Generate Questions" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Test saved", { exact: true })).toBeVisible();
}

test.describe.serial("TestMaker", () => {
  test.beforeAll(async () => {
    await resetEmulators();
    await seedLegacyTest();
  });

  test("browsers cannot read Firestore directly", async () => {
    const res = await unauthenticatedRead("tests/legacy_study_guide");
    expect(res.status).toBe(403);
  });

  test("an email that isn't allow-listed gets no access", async ({ page }) => {
    await signUp(page, E2E.outsider);
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create New Test" })).toHaveCount(0);
  });

  test("the owner signs up, verifies, and inherits legacy tests", async ({ page }) => {
    await signUp(page, E2E.teacher);
    await expect(page.getByRole("button", { name: "Create New Test" })).toBeVisible();

    await page.getByRole("button", { name: "My Library" }).click();
    await expect(page.getByText("Legacy Study Guide")).toBeVisible();
    await page.getByRole("button", { name: /Open Test/ }).click();
    await expect(page.getByRole("heading", { name: "Legacy Study Guide" })).toBeVisible();
    await expect(page.getByTestId("question-card")).toHaveCount(2);
    await expect(page.getByText("What directory does the App Router use?")).toBeVisible();

    // First sign-in created a personal workspace, and the legacy test lives in its course.
    const uid = await getUid(E2E.teacher);
    expect(await readDoc(`orgs/p_${uid}`)).toMatchObject({ kind: "personal" });
    expect(await readDoc(`orgs/p_${uid}/members/${uid}`)).toMatchObject({ role: "owner", orgKind: "personal" });
    expect(await readDoc("tests/legacy_study_guide")).toMatchObject({ ownerId: uid, courseId: `p_${uid}_default` });
  });

  test("generate, edit, take, export, version and restore a test", async ({ page }) => {
    await signIn(page, E2E.teacher);
    await generate(page, "Cell Biology", 4);
    const cards = page.getByTestId("question-card");
    await expect(cards).toHaveCount(4);
    // Both models contributed and each question shows an explanation and a verified quote.
    await expect(page.getByText("GPT-5.5").first()).toBeVisible();
    await expect(page.getByText("Gemini 3.6").first()).toBeVisible();
    await expect(cards.first().getByText("Because the material says so.")).toBeVisible();

    // Edit the first question; the change must survive a reload.
    await cards.first().getByRole("button", { name: "Edit question" }).click();
    await cards.first().getByLabel("Question text").fill("Edited: what powers the cell?");
    await cards.first().getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Question updated", { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Cell Biology" }).getByRole("button", { name: /Open Test/ }).click();
    await expect(page.getByText("Edited: what powers the cell?")).toBeVisible();

    // Take the test as a student, answering every question correctly.
    await page.getByRole("tab", { name: "Take test" }).click();
    for (const card of await cards.all()) {
      await card.getByRole("radio", { name: /Correct answer/ }).click();
    }
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.getByTestId("score-percentage")).toHaveText("100%");

    // Export two Word versions.
    await page.getByRole("tab", { name: "Edit & review" }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("radio", { name: "Word (.docx)" }).click();
    await page.getByRole("radio", { name: "A–B" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Cell_Biology.docx");
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");

    // Generating again under the same name archives version 1.
    await page.getByRole("button", { name: "Back to start" }).click();
    await generate(page, "Cell Biology", 2);
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(2);

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Version restored", { exact: true })).toBeVisible();
    await expect(page.getByText("v3", { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(4);
    await expect(page.getByText("Edited: what powers the cell?")).toBeVisible();
  });

  test("deleting a test removes it from the library", async ({ page }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("button", { name: "My Library" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete Legacy Study Guide" }).click();
    await expect(page.getByText("Test Deleted", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Legacy Study Guide" })).toHaveCount(0);
  });

  test("courses: create, save into, move, archive and delete", async ({ page }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByRole("button", { name: "New course" }).click();
    await page.getByLabel("Course name").fill("Biology 101");
    await page.getByLabel("Code (optional)").fill("BIO-101");
    await page.getByRole("button", { name: "Create course" }).click();
    await expect(page.getByText("Course created", { exact: true })).toBeVisible();
    const biology = page.getByRole("region", { name: "Biology 101" });
    const myTests = page.getByRole("region", { name: "My tests" });
    await expect(biology.getByText("No tests in this course yet.")).toBeVisible();

    // Generate straight into the new course.
    await generate(page, "Genetics Quiz", 2, "Biology 101 · BIO-101");
    await page.getByRole("button", { name: "Back to start" }).click();
    await page.getByRole("button", { name: "My Library" }).click();
    await expect(biology.getByText("Genetics Quiz")).toBeVisible();
    await expect(myTests.getByText("Genetics Quiz")).toHaveCount(0);

    // A course with tests can't be deleted.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete course Biology 101" }).click();
    await expect(page.getByText("Move or delete them first.", { exact: false })).toBeVisible();

    // Move the test to "My tests".
    await page.getByRole("button", { name: "Move Genetics Quiz" }).click();
    await page.getByRole("dialog").getByLabel("Course").selectOption({ label: "My tests" });
    await page.getByRole("dialog").getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Test moved", { exact: true })).toBeVisible();
    await expect(myTests.getByText("Genetics Quiz")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "My Library" }).click();
    await expect(myTests.getByText("Genetics Quiz")).toBeVisible();
    await expect(biology.getByText("No tests in this course yet.")).toBeVisible();

    // Archive hides the course; it can be shown and restored.
    await page.getByRole("button", { name: "Archive course Biology 101" }).click();
    await expect(page.getByText("Course archived", { exact: true })).toBeVisible();
    await expect(biology).toHaveCount(0);
    await page.getByLabel("Show archived").check();
    await page.getByRole("button", { name: "Restore course Biology 101" }).click();
    await expect(page.getByText("Course restored", { exact: true })).toBeVisible();

    // The default course can't be removed, so it offers no delete button.
    await expect(page.getByRole("button", { name: "Delete course My tests" })).toHaveCount(0);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete course Biology 101" }).click();
    await expect(page.getByText("Course deleted", { exact: true })).toBeVisible();
    await expect(biology).toHaveCount(0);
  });

  test("another allow-listed user gets a separate workspace", async ({ page }) => {
    await signUp(page, E2E.colleague);
    await expect(page.getByRole("button", { name: "Create New Test" })).toBeVisible();
    await page.getByRole("button", { name: "My Library" }).click();
    await expect(page.getByText("You haven't generated any tests yet.")).toBeVisible();
    await expect(page.getByText("Cell Biology")).toHaveCount(0);
  });

  test("an institution member gets in without being allow-listed", async ({ page }) => {
    await signUp(page, E2E.invitee);
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();

    const uid = await getUid(E2E.invitee);
    await writeDoc("orgs/inst_e2e", { name: "E2E University", kind: "institution" });
    await writeDoc(`orgs/inst_e2e/members/${uid}`, {
      uid,
      email: E2E.invitee,
      orgId: "inst_e2e",
      orgKind: "institution",
      role: "instructor",
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Create New Test" })).toBeVisible();
    // Being in an institution doesn't expose anyone else's tests.
    await page.getByRole("button", { name: "My Library" }).click();
    await expect(page.getByText("You haven't generated any tests yet.")).toBeVisible();
  });

  test("the platform allow-list in Firestore grants access", async ({ page }) => {
    await signIn(page, E2E.outsider);
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    await writeDoc("_meta/platform", { signupMode: "allowlist", allowedEmails: [E2E.outsider] });
    await page.reload();
    await expect(page.getByRole("button", { name: "Create New Test" })).toBeVisible();
  });
});
