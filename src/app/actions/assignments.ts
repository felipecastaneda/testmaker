'use server';

import { z } from 'zod';
import { MAX_STUDENTS_LIMIT, MAX_TIME_LIMIT_MINUTES } from '@/lib/assignments';
import type { ActionResult, AssignmentOptions, AssignmentStatus, AssignmentSummary } from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import * as repo from '@/server/assignments-repo';
import * as gradebook from '@/server/gradebook-repo';
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

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserFacingError(result.error.issues[0]?.message ?? 'Invalid input.');
  return result.data;
}

/** Snapshot the test's current questions into a new assignment. Returns its id. */
export async function createAssignment(
  idToken: string,
  testId: string,
  options: AssignmentOptions,
  open: boolean
): Promise<ActionResult<string>> {
  return withUser(idToken, (user) => repo.createAssignment(user, parse(Id, testId), parse(Options, options), open === true));
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
