'use server';

import { z } from 'zod';
import { MAX_STUDENTS_LIMIT, MAX_TIME_LIMIT_MINUTES } from '@/lib/assignments';
import { MAX_CLASS_LIST, PAPER_ID_MAX, PAPER_ID_MIN, PAPER_MAX_VERSIONS, type ClassListEntry, type PaperExam } from "@/lib/paper";
import type { ActionResult, AssignmentOptions, AssignmentStatus, AssignmentSummary, PaperOptions } from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import * as repo from '@/server/assignments-repo';
import * as gradebook from '@/server/gradebook-repo';
import * as paper from '@/server/paper-repo';
import type { GradebookView } from '@/lib/gradebook';

const Id = z.string().min(1).max(200).regex(/^[^/]+$/);
const Time = z.string().datetime({ offset: true, message: 'Invalid date.' }).nullable();
const Options = z.object({
  title: z.string().trim().min(1, 'Please give the assignment a title.').max(120, 'Titles are limited to 120 characters.'),
  opensAt: Time,
  closesAt: Time,
  timeLimitMinutes: z.number().int().min(1).max(MAX_TIME_LIMIT_MINUTES).nullable(),
  shuffleQuestions: z.boolean(),
  resultsRelease: z.enum(['immediately', 'after_close', 'manual']),
  showCorrectAnswers: z.boolean(),
  maxStudents: z.number().int().min(1, 'Allow at least 1 student.').max(MAX_STUDENTS_LIMIT, `At most ${MAX_STUDENTS_LIMIT} students.`),
});
const Patch = Options.partial().extend({ status: z.enum(['draft', 'open', 'closed']).optional() });
const Paper = z
  .object({
    versions: z.number().int().min(1).max(PAPER_MAX_VERSIONS, `At most ${PAPER_MAX_VERSIONS} versions.`),
    idLength: z.number().int().min(PAPER_ID_MIN).max(PAPER_ID_MAX, `Student IDs can have ${PAPER_ID_MIN}–${PAPER_ID_MAX} characters.`),
    idCharset: z.enum(['letters_digits', 'digits']),
  })
  .nullable();
const Scan = z.object({
  imageBase64: z.string().min(1).max(3_000_000),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
  corners: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).length(4),
});
const PaperAnswers = z.object({
  studentId: z.string().max(40),
  studentName: z.string().max(200),
  variant: z.string().length(1),
  letters: z.array(z.number().int().min(0).max(9).nullable()).max(200),
  replace: z.boolean(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserFacingError(result.error.issues[0]?.message ?? 'Invalid input.');
  return result.data;
}

/** Snapshot the test's current questions into a new assignment (online, or paper with `paper`). Returns its id. */
export async function createAssignment(
  idToken: string,
  testId: string,
  options: AssignmentOptions,
  open: boolean,
  paperOptions: PaperOptions | null = null
): Promise<ActionResult<string>> {
  return withUser(idToken, (user) =>
    repo.createAssignment(user, parse(Id, testId), parse(Options, options), open === true, parse(Paper, paperOptions))
  );
}

// Paper exams ----------------------------------------------------------------

/** Questions with the answer key and the version seed, for printing (professors only). */
export async function getPaperExam(idToken: string, id: string): Promise<ActionResult<PaperExam>> {
  return withUser(idToken, (user) => paper.getPaperExam(user, parse(Id, id)));
}

/** Grade and save one student's typed answers. Returns `saved: false` if the ID already has an attempt and `replace` is off. */
export async function savePaperAnswers(idToken: string, id: string, input: paper.PaperAnswersInput): Promise<ActionResult<paper.SavePaperResult>> {
  return withUser(idToken, (user) => paper.savePaperAnswers(user, parse(Id, id), parse(PaperAnswers, input)));
}

/** Like savePaperAnswers, plus the scanned sheet (JPEG, base64), which is stored with the attempt. */
export async function savePaperScan(
  idToken: string,
  id: string,
  input: paper.PaperAnswersInput,
  scan: { imageBase64: string; width: number; height: number; corners: { x: number; y: number }[] }
): Promise<ActionResult<paper.SavePaperResult>> {
  return withUser(idToken, (user) => {
    const s = parse(Scan, scan);
    return paper.savePaperAnswers(user, parse(Id, id), parse(PaperAnswers, input), { ...s, image: Buffer.from(s.imageBase64, "base64") });
  });
}

/** The stored scan of one paper attempt. */
export async function getPaperScan(idToken: string, id: string, attemptId: string): Promise<ActionResult<paper.PaperScanView>> {
  return withUser(idToken, (user) => paper.getPaperScan(user, parse(Id, id), parse(Id, attemptId)));
}

export async function listAssignments(idToken: string, courseId?: string): Promise<ActionResult<AssignmentSummary[]>> {
  return withUser(idToken, (user) => repo.listAssignments(user, courseId === undefined ? undefined : parse(Id, courseId)));
}

export async function getAssignment(idToken: string, id: string): Promise<ActionResult<AssignmentSummary>> {
  return withUser(idToken, (user) => repo.getAssignment(user, parse(Id, id)));
}

export async function updateAssignment(
  idToken: string,
  id: string,
  patch: Partial<AssignmentOptions> & { status?: AssignmentStatus }
): Promise<ActionResult<AssignmentSummary>> {
  return withUser(idToken, (user) => repo.updateAssignment(user, parse(Id, id), parse(Patch, patch)));
}

export async function deleteAssignment(idToken: string, id: string): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.deleteAssignment(user, parse(Id, id)));
}

// Gradebook ------------------------------------------------------------------

export async function getGradebook(idToken: string, id: string): Promise<ActionResult<GradebookView>> {
  return withUser(idToken, (user) => gradebook.getGradebook(user, parse(Id, id)));
}

export async function setResultsReleased(idToken: string, id: string, released: boolean): Promise<ActionResult> {
  return withUser(idToken, (user) => gradebook.setResultsReleased(user, parse(Id, id), parse(z.boolean(), released)));
}

export async function resetAttempt(idToken: string, id: string, attemptId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => gradebook.resetAttempt(user, parse(Id, id), parse(Id, attemptId)));
}

/** Returns the student's new deadline. */
export async function extendAttempt(idToken: string, id: string, attemptId: string, minutes: number): Promise<ActionResult<string>> {
  return withUser(idToken, (user) => gradebook.extendAttempt(user, parse(Id, id), parse(Id, attemptId), parse(z.number(), minutes)));
}

export async function regradeQuestion(idToken: string, id: string, questionId: string, accepted: string[]): Promise<ActionResult> {
  return withUser(idToken, (user) =>
    gradebook.regradeQuestion(user, parse(Id, id), parse(Id, questionId), parse(z.array(z.string().max(2_000)).max(20), accepted))
  );
}

/** Replace a paper exam's class list (empty removes it). Returns the saved list. */
export async function setClassList(idToken: string, id: string, entries: ClassListEntry[]): Promise<ActionResult<ClassListEntry[]>> {
  return withUser(idToken, (user) =>
    paper.setClassList(user, parse(Id, id), parse(z.array(z.object({ id: z.string().max(40), name: z.string().max(200) })).max(MAX_CLASS_LIST), entries))
  );
}
