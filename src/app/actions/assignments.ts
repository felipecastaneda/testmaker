'use server';

import { z } from 'zod';
import { MAX_TIME_LIMIT_MINUTES } from '@/lib/assignments';
import type { ActionResult, AssignmentOptions, AssignmentStatus, AssignmentSummary } from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import * as repo from '@/server/assignments-repo';

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
