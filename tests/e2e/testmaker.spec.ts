import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { E2E } from "../../playwright.config";
import { makePdf, makePptx } from "../fixtures/make-docs";
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

  test("upload a PowerPoint deck and a PDF and generate from them", async ({ page }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("button", { name: "Create New Test" }).click();
    const upload = page.locator("#file-upload");
    const content = page.getByLabel("Or Paste Content Directly");

    const deck = await makePptx([
      { lines: ["Cell organelles", "The mitochondria is the powerhouse of the cell and produces most of its ATP."] },
      { lines: ["Ribosomes are the molecular machines that assemble proteins from amino acids."], notes: ["The Golgi apparatus modifies, sorts and packages proteins."] },
    ]);
    await upload.setInputFiles({ name: "Organelles_Lecture.pptx", mimeType: "application/octet-stream", buffer: Buffer.from(deck) });
    await expect(content).toHaveValue(/^--- Slide 1 ---\nCell organelles/);
    await expect(content).toHaveValue(/Speaker notes:\nThe Golgi apparatus modifies/);
    await expect(page.getByLabel("Test Name")).toHaveValue("Organelles Lecture");

    // The PDF library loads on demand in the browser.
    const pdf = makePdf([
      ["Photosynthesis takes place in the chloroplasts of plant cells.", "Light energy is converted into chemical energy stored in glucose."],
      ["The Calvin cycle fixes carbon dioxide into sugars without needing light directly."],
    ]);
    await upload.setInputFiles({ name: "photosynthesis.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
    await expect(content).toHaveValue(/^--- Page 1 ---\nPhotosynthesis takes place in the chloroplasts/);
    await expect(content).toHaveValue(/--- Page 2 ---\nThe Calvin cycle fixes carbon dioxide/);

    await page.getByLabel("Test Name").fill("PDF Quiz");
    await page.getByLabel("Number of questions").fill("2");
    await page.getByRole("button", { name: "Generate Questions" }).click();
    await expect(page.getByRole("heading", { name: "PDF Quiz" })).toBeVisible();
    await expect(page.getByTestId("question-card")).toHaveCount(2);

    // A scanned PDF (no text) gets a clear explanation.
    await page.getByRole("button", { name: "Back to start" }).click();
    await page.getByRole("button", { name: "Create New Test" }).click();
    await page.locator("#file-upload").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf([[]])) });
    await expect(page.getByText("This PDF looks scanned", { exact: false })).toBeVisible();
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

  test("assignments: assign a test online, open/close, edit, snapshot, list, delete", async ({ page }) => {
    await signIn(page, E2E.teacher);
    // A course default pre-fills the time limit.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Courses" }).click();
    const limitSetting = page.getByTestId("course-setting-assignments.defaultTimeLimit");
    await limitSetting.getByLabel("Use the organization's setting").uncheck();
    await limitSetting.getByLabel("Default time limit (minutes)").fill("30");
    await page.getByRole("button", { name: "Save course settings" }).click();
    await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

    // Open the "Points Quiz" test (2 questions, 5 points) and assign it.
    await page.getByRole("link", { name: "Back to TestMaker" }).click();
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Points Quiz" }).getByRole("button", { name: /Open Test/ }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Title students see")).toHaveValue("Points Quiz");
    await expect(dialog.getByLabel("Time limit in minutes (optional)")).toHaveValue("30");
    await dialog.getByLabel("Title students see").fill("Quiz 1 online");
    await dialog.getByRole("button", { name: "Create and open" }).click();

    await expect(page).toHaveURL(/\/assignments\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Quiz 1 online" })).toBeVisible();
    await expect(page.getByTestId("availability")).toHaveText("Open");
    await expect(page.getByText("2 questions · 5 pts", { exact: false })).toBeVisible();
    await expect(page.getByText("30 minutes")).toBeVisible();
    const code = (await page.getByTestId("join-code").textContent())!;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    await expect(page.getByLabel("Link", { exact: true })).toHaveValue(new RegExp(`/take/${code}$`));

    // Close and reopen.
    await page.getByRole("button", { name: "Close now" }).click();
    await expect(page.getByTestId("availability")).toHaveText("Closed");
    await page.getByRole("button", { name: "Open now" }).click();
    await expect(page.getByTestId("availability")).toHaveText("Open");

    // Edit: invalid window is refused, a valid change is saved.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Opens (optional)").fill("2030-01-02T10:00");
    await page.getByLabel("Closes (optional)").fill("2030-01-01T10:00");
    await expect(page.getByRole("alert").filter({ hasText: "The closing time must be after the opening time." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await page.getByLabel("Opens (optional)").fill("");
    await page.getByLabel("Closes (optional)").fill("");
    await page.getByLabel("Title students see").fill("Quiz 1 (edited)");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Quiz 1 (edited)" })).toBeVisible();
    const assignmentUrl = page.url();

    // The assignment is a snapshot: deleting a question from the test doesn't change it.
    await page.goto("/");
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Points Quiz" }).getByRole("button", { name: /Open Test/ }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("question-card").first().getByRole("button", { name: "Delete question" }).click();
    await expect(page.getByTestId("question-card")).toHaveCount(1);
    await page.goto(assignmentUrl);
    await expect(page.getByText("2 questions · 5 pts", { exact: false })).toBeVisible();

    // The list shows it; a draft can be saved too; deleting removes it.
    await page.getByRole("link", { name: "Assignments", exact: true }).click();
    await expect(page.getByTestId("assignment-item").filter({ hasText: "Quiz 1 (edited)" })).toBeVisible();
    await page.goto("/");
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Points Quiz" }).getByRole("button", { name: /Open Test/ }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByTestId("availability")).toHaveText("Draft");
    await expect(page.getByText("1 questions", { exact: false })).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/assignments$/);
    await expect(page.getByTestId("assignment-item")).toHaveCount(1);
  });

  test("students take an exam: join, autosave, resume, submit, grade, results policy, closing", async ({ page, browser }) => {
    await signIn(page, E2E.teacher);
    // A 3-question test; "My tests" gives 2 points per question (set earlier).
    await generate(page, "Exam Source", 3);

    const assign = async (title: string, release: "Right after they submit" | "When the assignment closes", limit = "") => {
      await page.getByRole("button", { name: "Assign", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Title students see").fill(title);
      await dialog.getByLabel("Time limit in minutes (optional)").fill(limit);
      await dialog.getByLabel("Students see their results").selectOption({ label: release });
      await dialog.getByRole("button", { name: "Create and open" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      return (await page.getByTestId("join-code").textContent())!;
    };
    const join = async (code: string, name: string, id: string) => {
      const student = await otherPerson(browser);
      await student.goto("/take");
      // Students may type the code in lower case with a dash.
      await student.getByLabel("Exam code").fill(`${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`);
      await student.getByRole("button", { name: "Continue" }).click();
      await student.getByLabel("Full name").fill(name);
      await student.getByLabel("Student ID").fill(id);
      await student.getByRole("button", { name: "Start exam" }).click();
      return student;
    };

    // --- Assignment 1: results right after submitting, with correct answers.
    const code1 = await assign("Quiz A", "Right after they submit");
    const ana = await join(code1, "Ana Pérez", "A-001");
    const questions = ana.getByTestId("exam-question");
    await expect(questions).toHaveCount(3);
    await expect(ana.getByText("Ana Pérez · 0 of 3 answered")).toBeVisible();
    await questions.nth(0).getByRole("radio", { name: /Correct answer/ }).click();
    await questions.nth(1).getByRole("radio", { name: /Wrong answer/ }).first().click();
    await expect(ana.getByTestId("save-status")).toHaveText("All answers saved");

    // Refreshing resumes the same attempt with the saved answers.
    await ana.reload();
    await expect(ana.getByText("Ana Pérez · 2 of 3 answered")).toBeVisible();
    await expect(questions.nth(0).getByRole("radio", { name: /Correct answer/ })).toHaveAttribute("aria-checked", "true");

    ana.once("dialog", (d) => d.accept()); // one question unanswered
    await ana.getByRole("button", { name: "Submit answers" }).click();
    await expect(ana.getByTestId("student-score")).toHaveText("2 / 6 pts · 33%");
    const results = ana.getByTestId("result-question");
    await expect(results).toHaveCount(3);
    await expect(results.nth(1).getByText("Correct answer:", { exact: false })).toBeVisible();

    // The same student ID (typed differently) can't start a second attempt.
    const impostor = await join(code1, "Someone Else", "a-001");
    await expect(impostor.getByRole("alert").filter({ hasText: "already started" })).toBeVisible();
    await impostor.context().close();

    await page.reload();
    await expect(page.getByTestId("assignment-stats")).toHaveText("1 started · 1 submitted");

    // --- Assignment 2: results when it closes, 30-minute limit.
    await page.goto("/");
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Exam Source" }).getByRole("button", { name: /Open Test/ }).click();
    const code2 = await assign("Quiz B", "When the assignment closes", "30");

    const ben = await join(code2, "Ben", "B-002");
    await expect(ben.getByTestId("time-remaining")).toHaveText(/^\s*(30:00|29:[0-5]\d)$/);
    for (const q of await ben.getByTestId("exam-question").all()) await q.getByRole("radio", { name: /Correct answer/ }).click();
    await expect(ben.getByTestId("save-status")).toHaveText("All answers saved");
    ben.once("dialog", (d) => d.accept());
    await ben.getByRole("button", { name: "Submit answers" }).click();
    await expect(ben.getByTestId("results-pending")).toContainText("when the exam closes");

    const carla = await join(code2, "Carla", "C-003");
    await carla.getByTestId("exam-question").first().getByRole("radio", { name: /Correct answer/ }).click();
    await expect(carla.getByTestId("save-status")).toHaveText("All answers saved");

    // The professor closes it: Ben sees his score, Carla's saved answers are submitted.
    await page.getByRole("button", { name: "Close now" }).click();
    await expect(page.getByTestId("availability")).toHaveText("Closed");
    await ben.reload();
    await expect(ben.getByTestId("student-score")).toHaveText("6 / 6 pts · 100%");
    await carla.reload();
    await expect(carla.getByText("The exam ended", { exact: false })).toBeVisible();
    await expect(carla.getByTestId("student-score")).toHaveText("2 / 6 pts · 33%");

    // Nobody new can join a closed exam.
    const late = await otherPerson(browser);
    await late.goto(`/take/${code2}`);
    await expect(late.getByTestId("exam-unavailable")).toHaveText("This exam is closed.");

    await page.reload();
    await expect(page.getByTestId("assignment-stats")).toHaveText("2 started · 2 submitted");
    for (const p of [ana, ben, carla, late]) await p.context().close();
  });

  test("gradebook: scores, item %, regrade, extra time, release, CSV, reset", async ({ page, browser }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Exam Source" }).getByRole("button", { name: /Open Test/ }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title students see").fill("Quiz C");
    await dialog.getByLabel("Time limit in minutes (optional)").fill("30");
    await dialog.getByLabel("Students see their results").selectOption({ label: "When I release them" });
    await dialog.getByRole("button", { name: "Create and open" }).click();
    await expect(page.getByRole("heading", { name: "Quiz C" })).toBeVisible();
    const code = (await page.getByTestId("join-code").textContent())!;
    const gradebookUrl = page.url();

    const join = async (name: string, id: string) => {
      const student = await otherPerson(browser);
      await student.goto(`/take/${code}`);
      await student.getByLabel("Full name").fill(name);
      await student.getByLabel("Student ID").fill(id);
      await student.getByRole("button", { name: "Start exam" }).click();
      await expect(student.getByTestId("exam-question")).toHaveCount(3);
      return student;
    };

    // Dana gets question 2 wrong; Eli is still working.
    const dana = await join("Dana", "D-004");
    const dq = dana.getByTestId("exam-question");
    await dq.nth(0).getByRole("radio", { name: /Correct answer/ }).click();
    const wrongOption = dq.nth(1).getByRole("radio", { name: /Wrong answer/ }).first();
    const wrongText = (await wrongOption.textContent())!.replace(/^[A-Z]/, "").trim();
    await wrongOption.click();
    await dq.nth(2).getByRole("radio", { name: /Correct answer/ }).click();
    await expect(dana.getByTestId("save-status")).toHaveText("All answers saved");
    dana.once("dialog", (d) => d.accept());
    await dana.getByRole("button", { name: "Submit answers" }).click();
    await expect(dana.getByTestId("results-pending")).toContainText("professor will release");

    const eli = await join("Eli", "E-005");
    await eli.getByTestId("exam-question").first().getByRole("radio", { name: /Correct answer/ }).click();
    await expect(eli.getByTestId("save-status")).toHaveText("All answers saved");

    // The gradebook.
    await page.reload();
    const rows = page.getByTestId("gradebook-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("gradebook-summary")).toHaveText("1 submitted · 1 in progress · average 67%");
    await expect(rows.filter({ hasText: "Dana" }).getByTestId("row-score")).toHaveText("4 / 6 pts (67%)");
    await expect(rows.filter({ hasText: "Eli" })).toContainText("In progress");
    await expect(page.getByTestId("q-stat-2")).toHaveText("0%");

    // Regrade question 2 to also accept Dana's answer.
    await page.getByRole("button", { name: /^Question 2: 0% correct, regrade$/ }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: wrongText }).check();
    await page.getByRole("button", { name: "Save and regrade" }).click();
    await expect(page.getByText("Question regraded; grades updated", { exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Dana" }).getByTestId("row-score")).toHaveText("6 / 6 pts (100%)");
    await expect(page.getByTestId("q-stat-2")).toHaveText("100%");

    // Ten extra minutes for Eli; his own timer shows them.
    page.once("dialog", (d) => d.accept("10"));
    await page.getByRole("button", { name: "Extra time for Eli" }).click();
    await expect(page.getByText("Eli has 10 more minutes", { exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Eli" })).toContainText("extra time until");
    await eli.reload();
    await expect(eli.getByTestId("time-remaining")).toHaveText(/^\s*(40:00|39:[0-5]\d)$/);

    // Releasing results shows Dana her (regraded) score; hiding takes it back.
    await page.getByRole("button", { name: "Release results" }).click();
    await expect(page.getByText("Results released to students", { exact: true })).toBeVisible();
    await dana.reload();
    await expect(dana.getByTestId("student-score")).toHaveText("6 / 6 pts · 100%");
    await page.getByRole("button", { name: "Hide results" }).click();
    await expect(page.getByText("Results hidden from students", { exact: true })).toBeVisible();
    await dana.reload();
    await expect(dana.getByTestId("results-pending")).toBeVisible();

    // CSV export.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("Quiz_C_grades.csv");
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Name,Student ID,Status,Started,Submitted,Minutes,Score,Possible,Percent,Left page,Q1,Q2,Q3");
    expect(csv).toMatch(/\r\nDana,D-004,Submitted,[^,]+,[^,]+,\d+,6,6,100,\d+,2,2,2\r\n/);
    expect(csv).toMatch(/\r\nEli,E-005,In progress,/);

    // Reset Eli: his old session ends and he can start again with the same ID.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Reset Eli" }).click();
    await expect(page.getByText("Attempt reset", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(1);
    await eli.reload();
    await expect(eli.getByLabel("Student ID")).toBeVisible();
    await eli.getByLabel("Full name").fill("Eli");
    await eli.getByLabel("Student ID").fill("E-005");
    await eli.getByRole("button", { name: "Start exam" }).click();
    await expect(eli.getByText("Eli · 0 of 3 answered")).toBeVisible();

    await page.goto(gradebookUrl);
    await expect(page.getByTestId("assignment-stats")).toHaveText("2 started · 1 submitted");
    for (const p of [dana, eli]) await p.context().close();
  });

  test("exam guards: student limit, and leaving the page is logged", async ({ page, browser }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Exam Source" }).getByRole("button", { name: /Open Test/ }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title students see").fill("Quiz D");
    await expect(dialog.getByLabel("Maximum students")).toHaveValue("200");
    await dialog.getByLabel("Maximum students").fill("0");
    await expect(dialog.getByRole("alert")).toContainText("Maximum students must be");
    await dialog.getByLabel("Maximum students").fill("1");
    await dialog.getByRole("button", { name: "Create and open" }).click();
    await expect(page.getByRole("heading", { name: "Quiz D" })).toBeVisible();
    const code = (await page.getByTestId("join-code").textContent())!;

    const join = async (name: string, id: string) => {
      const student = await otherPerson(browser);
      await student.goto(`/take/${code}`);
      await student.getByLabel("Full name").fill(name);
      await student.getByLabel("Student ID").fill(id);
      await student.getByRole("button", { name: "Start exam" }).click();
      return student;
    };

    const fay = await join("Fay", "F-006");
    await expect(fay.getByTestId("exam-question")).toHaveCount(3);
    await expect(fay.getByText("Your professor can see how many times you left this page", { exact: false })).toBeVisible();

    // The limit is 1, so a second student is refused.
    const gus = await join("Gus", "G-007");
    await expect(gus.getByRole("alert").filter({ hasText: "reached its student limit" })).toBeVisible();

    // Fay switches away twice (simulated: headless pages never really lose visibility).
    for (let i = 0; i < 2; i++) {
      await fay.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      });
    }
    await expect
      .poll(async () => {
        await page.reload();
        return page.getByTestId("gradebook-row").filter({ hasText: "Fay" }).getByTestId("row-left-page").textContent();
      })
      .toBe("2×");
    for (const p of [fay, gus]) await p.context().close();
  });

  test("paper exams: assign on paper, print versions and sheets, type answers, grade, CSV", async ({ page }) => {
    await signIn(page, E2E.teacher);
    await page.getByRole("button", { name: "My Library" }).click();
    await page.getByTestId("library-item").filter({ hasText: "Exam Source" }).getByRole("button", { name: /Open Test/ }).click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Paper/ }).click();
    await expect(dialog.getByRole("heading", { name: "Assign on paper" })).toBeVisible();
    await dialog.getByLabel("Title on the exam").fill("Paper Quiz");
    await dialog.getByLabel("Characters in an ID").fill("3");
    await expect(dialog.getByRole("alert")).toContainText("Student ID length must be 4–12");
    await dialog.getByLabel("Characters in an ID").fill("6");
    await expect(dialog.getByLabel("Versions")).toHaveValue("2");
    await dialog.getByRole("button", { name: "Create paper exam" }).click();

    await expect(page.getByRole("heading", { name: "Paper Quiz" })).toBeVisible();
    await expect(page.getByTestId("availability")).toHaveText("Paper");
    await expect(page.getByRole("region", { name: "Share with students" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open now" })).toHaveCount(0);

    // Print view: a booklet and a key per version, and the requested answer sheets.
    await page.getByLabel("Answer sheets per version").fill("2");
    const [print] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Open print view" }).click()]);
    await expect(print.locator(".booklet")).toHaveCount(2);
    await expect(print.locator("svg.sheet")).toHaveCount(4);
    await expect(print.locator('.sheet-page[data-version="B"] svg.sheet')).toHaveCount(2);
    await expect(print.locator(".key")).toHaveCount(2);
    const keyB = (await print.locator('.key[data-version="B"] .keylist strong').allTextContents()).join("");
    expect(keyB).toMatch(/^[A-E]{3}$/);
    await print.close();

    // Type Hana's sheet (version B, all correct).
    await page.getByLabel("Student ID").fill("ab1234");
    await page.getByLabel(/^Name/).fill("Hana");
    await page.getByLabel("Version", { exact: true }).selectOption("B");
    await page.getByLabel("Answers", { exact: true }).fill("AAAA");
    await expect(page.getByRole("alert").filter({ hasText: "That's 4 answers" })).toBeVisible();
    await page.getByLabel("Answers", { exact: true }).fill(keyB.split("").join(" "));
    await expect(page.getByTestId("typed-preview")).toContainText("3 of 3 answered");
    await expect(page.getByTestId("typed-preview")).toContainText("(100%)");
    await page.getByLabel("Answers", { exact: true }).press("Enter");
    await expect(page.getByText("Saved Hana", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Student ID")).toHaveValue("");
    const rows = page.getByTestId("gradebook-row");
    const hana = rows.filter({ hasText: "Hana" });
    await expect(hana.getByTestId("row-version")).toHaveText("B · typed");
    await expect(hana.getByText("AB1234")).toBeVisible();
    await expect(hana.getByTestId("row-score")).toContainText("(100%)");

    // A student without a name, version A, one blank.
    await page.getByLabel("Student ID").fill("CD5678");
    // The version stays as chosen (handy for a stack of B sheets); this one is an A.
    await expect(page.getByLabel("Version", { exact: true })).toHaveValue("B");
    await page.getByLabel("Version", { exact: true }).selectOption("A");
    await page.getByLabel("Answers", { exact: true }).fill("-");
    await expect(page.getByTestId("typed-preview")).toContainText("0 of 3 answered");
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "CD5678" }).getByTestId("row-score")).toContainText("(0%)");
    await expect(page.getByTestId("assignment-stats")).toHaveText("2 entered");

    // Entering Hana again asks before replacing her answers.
    await page.getByLabel("Student ID").fill("AB1234");
    await page.getByLabel("Version", { exact: true }).selectOption("B");
    await page.getByLabel("Answers", { exact: true }).fill("---");
    page.once("dialog", (d) => {
      expect(d.message()).toContain("Hana");
      void d.accept();
    });
    await page.getByRole("button", { name: "Save and next" }).click();
    await expect(hana.getByTestId("row-score")).toContainText("(0%)");
    await expect(hana.getByText("AB1234")).toBeVisible(); // name kept

    // CSV has the version and entry instead of times.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv).toContain("Name,Student ID,Version,Entered,Saved,Score,Possible,Percent,Q1,Q2,Q3");
    expect(csv).toMatch(/\r\nHana,AB1234,B,Typed,/);
    expect(csv).toMatch(/\r\n,CD5678,A,Typed,/);

    // Delete an entry.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete CD5678" }).click();
    await expect(rows).toHaveCount(1);

    // The list shows it as a paper exam.
    await page.getByRole("link", { name: "All assignments" }).click();
    await expect(page.getByTestId("assignment-item").filter({ hasText: "Paper Quiz" }).getByTestId("availability")).toHaveText("Paper");
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
    await page.getByTestId("org-setting-assistants.canEdit").getByLabel("Lock for all courses").check();
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
