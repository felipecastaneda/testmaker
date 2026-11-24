import { expect, test, type Browser, type Page } from "@playwright/test";
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

/** A separate browser session, for a second person. */
async function otherPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** Create an account and verify it on whatever page is open (e.g. an invite link). */
async function signUpHere(page: Page, email: string) {
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

  test("points and tags: course default, AI tags, editing, weighted score", async ({ page }) => {
    await signIn(page, E2E.teacher);
    // New questions in "My tests" are worth 2 points.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Courses" }).click();
    const defaultPoints = page.getByTestId("course-setting-questions.defaultPoints");
    await defaultPoints.getByLabel("Use the organization's setting").uncheck();
    await defaultPoints.getByLabel("Default points per question").fill("2");
    await page.getByRole("button", { name: "Save course settings" }).click();
    await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Back to TestMaker" }).click();
    await generate(page, "Points Quiz", 2);
    const cards = page.getByTestId("question-card");
    await expect(page.getByTestId("total-points")).toHaveText("4 pts");
    await expect(cards.first().getByTestId("question-points")).toHaveText("2 pts");
    // AI tags arrive cleaned up (lower-case, no "#").
    await expect(cards.first().getByTestId("question-tag").first()).toHaveText("cell biology");

    // Edit one question's points and tags.
    const first = cards.first();
    await first.getByRole("button", { name: "Edit question" }).click();
    await first.getByLabel("Points").fill("3");
    await first.getByLabel("Tags").fill("Genetics, cell biology, genetics");
    await first.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Question updated", { exact: true })).toBeVisible();
    await expect(page.getByTestId("total-points")).toHaveText("5 pts");
    await expect(first.getByTestId("question-tag")).toHaveText(["genetics", "cell biology"]);

    // Saved: still there after reopening from the library.
    await page.reload();
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Points Quiz" }).getByRole("button", { name: /Open Test/ }).click();
    await expect(page.getByTestId("total-points")).toHaveText("5 pts");
    await expect(cards.first().getByTestId("question-points")).toHaveText("3 pts");

    // The score is weighted by points: missing the 3-point question leaves 2 of 5.
    await page.getByRole("tab", { name: "Take test" }).click();
    await cards.nth(0).getByRole("radio", { name: /Wrong answer/ }).first().click();
    await cards.nth(1).getByRole("radio", { name: /Correct answer/ }).click();
    await page.getByRole("button", { name: "Submit answers" }).click();
    await expect(page.getByTestId("score-percentage")).toHaveText("40%");
    await expect(page.getByTestId("score-points")).toHaveText("2 of 5 pts");
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
    await expect(page.getByText("This course still has 1 test. Move or delete them first.", { exact: true })).toBeVisible();

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

  test("settings: org and course settings shape generation; locks and preferences", async ({ page }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("tabpanel").getByText(E2E.teacher)).toBeVisible();

    // Organization: rename, allow only GPT, add instructions, lock "assistants can edit".
    await page.getByRole("tab", { name: "Organization" }).click();
    await page.getByLabel("Name").fill("Teacher Workspace");
    await page.getByRole("checkbox", { name: "Gemini 3.6" }).uncheck();
    await page.getByLabel("Organization instructions for the AI").fill("Write in Spanish.");
    await page.getByLabel("Lock for all courses").check();
    await page.getByRole("button", { name: "Save organization settings" }).click();
    await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

    // Course: its own instructions; the locked setting is read-only.
    await page.getByRole("tab", { name: "Courses" }).click();
    await expect(page.getByTestId("course-setting-assistants.canEdit").getByText("Set by your organization")).toBeVisible();
    await expect(page.getByLabel("Assistants can edit tests")).toBeDisabled();
    await page.getByLabel("Course instructions for the AI").fill("Focus on organelles.");
    await page.getByRole("button", { name: "Save course settings" }).click();
    await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

    // Settings survive a reload.
    await page.reload();
    await page.getByRole("tab", { name: "Organization" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Teacher Workspace");
    await expect(page.getByRole("checkbox", { name: "Gemini 3.6" })).not.toBeChecked();

    // Generation: Gemini is skipped and both instructions reach the AI.
    await page.getByRole("link", { name: "Back to TestMaker" }).click();
    await page.getByRole("button", { name: "Create New Test" }).click();
    await expect(page.getByText("Some AI models will be skipped")).toBeVisible();
    await expect(page.getByTestId("instructions-note")).toBeVisible();
    await page.getByLabel("Test Name").fill("Spanish Quiz");
    await page.getByLabel("Number of questions").fill("2");
    await page.getByLabel("Or Paste Content Directly").fill(STUDY_TEXT);
    await page.getByRole("button", { name: "Generate Questions" }).click();
    await expect(page.getByRole("heading", { name: "Spanish Quiz" })).toBeVisible();
    const cards = page.getByTestId("question-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.getByText("Gemini 3.6")).toHaveCount(0);
    await expect(cards.first().getByText("[Instructions: Write in Spanish. Focus on organelles.]", { exact: false })).toBeVisible();

    // Profile: preferred models are saved to the account and drive the navbar picker.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("checkbox", { name: "GPT-5.5" }).uncheck();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
    await page.goto("/");
    const picker = page.getByRole("group", { name: "AI models" });
    await expect(picker.getByRole("button", { name: "GPT-5.5" })).toHaveAttribute("aria-pressed", "false");
    await expect(picker.getByRole("button", { name: "Gemini 3.6" })).toHaveAttribute("aria-pressed", "true");
    // ...and with the org allowing only GPT, nothing is left to generate with.
    await page.getByRole("button", { name: "Create New Test" }).click();
    await expect(page.getByText("None of your selected AI models are enabled here")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate Questions" })).toBeDisabled();
  });

  test("institutions: create, invite, accept, course staff, switch, roles and removal", async ({ page, browser }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("link", { name: "Settings" }).click();

    // The teacher is a platform admin, so they can create an institution.
    await page.getByRole("tab", { name: "Organization" }).click();
    await page.getByRole("button", { name: "New institution" }).click();
    await page.getByLabel("Institution name").fill("E2E College");
    await page.getByRole("button", { name: "Create institution" }).click();
    await expect(page.getByText("Institution created", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Active organization").locator("option:checked")).toHaveText("E2E College");

    // Invite a newcomer who isn't on any allow-list.
    await page.getByRole("tab", { name: "Members" }).click();
    await page.getByLabel("Email").fill(E2E.newcomer);
    await page.getByLabel("Role", { exact: true }).selectOption("instructor");
    await page.getByRole("button", { name: "Create invite link" }).click();
    const link = await page.getByLabel("Invite link").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
    await expect(page.getByRole("list", { name: "Pending invites" }).getByText(E2E.newcomer)).toBeVisible();

    // The newcomer signs up from the link and accepts.
    const newcomer = await otherPerson(browser);
    await newcomer.goto(link);
    await expect(newcomer.getByText("You've been invited to TestMaker.", { exact: false })).toBeVisible();
    await signUpHere(newcomer, E2E.newcomer);
    await expect(newcomer.getByRole("heading", { name: "Join E2E College" })).toBeVisible();
    await newcomer.getByRole("button", { name: "Accept invite" }).click();
    await expect(newcomer.getByRole("button", { name: "Create New Test" })).toBeVisible();
    // No course yet, so nothing to save into.
    await newcomer.getByRole("button", { name: "Create New Test" }).click();
    await expect(newcomer.getByText("No course to save into")).toBeVisible();

    // The link only works once.
    await newcomer.goto(link);
    await expect(newcomer.getByText("This invite has already been used.")).toBeVisible();

    // The teacher creates a course in the institution and puts the newcomer on its staff.
    await page.getByRole("link", { name: "Back to TestMaker" }).click();
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByRole("button", { name: "New course" }).click();
    await page.getByLabel("Course name").fill("Chem 101");
    await page.getByRole("button", { name: "Create course" }).click();
    await expect(page.getByRole("region", { name: "Chem 101" })).toBeVisible();
    // The library only shows the active organization: the personal "My tests" isn't here.
    await expect(page.getByRole("region", { name: "My tests" })).toHaveCount(0);

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Courses" }).click();
    await page.getByLabel("Course", { exact: true }).selectOption({ label: "Chem 101" });
    await page.getByLabel("Add a member").selectOption({ label: E2E.newcomer });
    await page.getByLabel("As", { exact: true }).selectOption("instructor");
    await page.getByRole("button", { name: "Add to course" }).click();
    await expect(page.getByText("Added to course", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Course staff" }).getByText(E2E.newcomer)).toBeVisible();

    await newcomer.goto("/");
    await newcomer.getByRole("button", { name: "My Library" }).click();
    await expect(newcomer.getByRole("region", { name: "Chem 101" })).toBeVisible();

    // Switching organizations changes what the library shows, and is remembered.
    await page.getByRole("link", { name: "Back to TestMaker" }).click();
    await page.getByLabel("Active organization").selectOption({ label: "Teacher Workspace" });
    await page.getByRole("button", { name: "My Library" }).click();
    await expect(page.getByRole("region", { name: "My tests" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Chem 101" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Active organization").locator("option:checked")).toHaveText("Teacher Workspace");

    // Change the newcomer's role, then remove them: they lose access entirely.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Members" }).click();
    await page.getByLabel(`Role for ${E2E.newcomer}`).selectOption("assistant");
    await expect(page.getByText("Role updated", { exact: true })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("member-row").filter({ hasText: E2E.newcomer }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Member removed", { exact: true })).toBeVisible();
    await newcomer.reload();
    await expect(newcomer.getByRole("heading", { name: "No access" })).toBeVisible();

    // An invite only works for the email it was sent to.
    await page.getByLabel("Email").fill("someone-else@example.com");
    await page.getByRole("button", { name: "Create invite link" }).click();
    const otherLink = await page.getByLabel("Invite link").inputValue();
    await newcomer.goto(otherLink);
    await expect(newcomer.getByText("This invite is for someone-else@example.com", { exact: false })).toBeVisible();
    await expect(newcomer.getByRole("button", { name: "Accept invite" })).toHaveCount(0);

    // Revoked invites stop working.
    await page.getByRole("button", { name: "Revoke invite for someone-else@example.com" }).click();
    await expect(page.getByText("Invite revoked", { exact: true })).toBeVisible();
    await newcomer.reload();
    await expect(newcomer.getByText("This invite was cancelled.", { exact: false })).toBeVisible();
    await newcomer.context().close();
  });

  test("platform admins manage the allow-list from Settings", async ({ page, browser }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Platform" }).click();
    await page.getByLabel("Allowed emails").fill(E2E.late);
    await page.getByRole("button", { name: "Save platform settings" }).click();
    await expect(page.getByText("Platform settings saved", { exact: true })).toBeVisible();

    const late = await otherPerson(browser);
    await late.goto("/");
    await signUpHere(late, E2E.late);
    await expect(late.getByRole("button", { name: "Create New Test" })).toBeVisible();
    // Non-admins don't see the Platform tab.
    await late.getByRole("link", { name: "Settings" }).click();
    await expect(late.getByRole("tab", { name: "Profile" })).toBeVisible();
    await expect(late.getByRole("tab", { name: "Platform" })).toHaveCount(0);
    await late.context().close();
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
