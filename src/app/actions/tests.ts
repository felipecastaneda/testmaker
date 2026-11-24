'use server';

import { z } from 'zod';
import type {
  ActionResult,
  QuestionData,
  SaveMode,
  SaveTestOutcome,
  StoredTest,
  TestSummary,
  TestVersionSummary,
} from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import { serverConfig } from '@/server/config';
import * as repo from '@/server/tests-repo';
import { MAX_POINTS, normalizeTags } from '@/lib/question-utils';
import { ensureUserWorkspace, listViewableCourseIds } from '@/server/workspace';

const MAX_QUESTIONS_PER_SAVE = 500;

const QuestionSchema = z.object({
  id: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(5_000),
  correctAnswer: z.string().trim().min(1).max(2_000),
  distractors: z.array(z.string().trim().min(1).max(2_000)).min(1).max(6),
  type: z.enum(['multiple_choice', 'true_false']).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  explanation: z.string().max(5_000).optional(),
  sourceQuote: z.string().max(5_000).optional(),
  imageUrl: z.string().url().max(2_000).optional(),
  sourceModel: z.string().max(100).optional(),
  points: z.number().min(0).max(MAX_POINTS).multipleOf(0.5, 'Points must be whole or half numbers.').optional(),
  // Cleaned the same way the editor and the AI output are.
  tags: z.array(z.string().max(200)).max(50).transform((t) => normalizeTags(t)).optional(),
});

function parseQuestions(questions: unknown, max = MAX_QUESTIONS_PER_SAVE): QuestionData[] {
  const parsed = z.array(QuestionSchema).max(max).safeParse(questions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new UserFacingError(`Invalid question data${issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''}.`);
  }
  return parsed.data;
}

function parseQuestion(question: unknown): QuestionData {
  return parseQuestions([question], 1)[0];
}

export async function listTests(idToken: string): Promise<ActionResult<TestSummary[]>> {
  return withUser(idToken, async (user) => {
    const workspace = await ensureUserWorkspace(user);
    if (user.email === serverConfig.legacyOwnerEmail) {
      await repo.migrateLegacyTests(user.uid, { orgId: workspace.personalOrgId, courseId: workspace.defaultCourseId });
    }
    return repo.listTests(await listViewableCourseIds(user.uid));
  });
}

export async function loadTest(idToken: string, testId: string): Promise<ActionResult<StoredTest>> {
  return withUser(idToken, (user) => repo.loadTest(user, testId));
}

export async function saveTest(
  idToken: string,
  name: string,
  questions: QuestionData[],
  mode: SaveMode,
  /** Defaults to the user's personal "My tests" course. */
  courseId?: string
): Promise<ActionResult<SaveTestOutcome>> {
  return withUser(idToken, async (user) => {
    if (!['new_version', 'append', 'recreate'].includes(mode)) throw new UserFacingError('Invalid save mode.');
    if (typeof name !== 'string' || name.length > 120) throw new UserFacingError('Test names are limited to 120 characters.');
    const targetCourse = courseId ?? (await ensureUserWorkspace(user)).defaultCourseId;
    return repo.saveTest(user, targetCourse, name, parseQuestions(questions), mode);
  });
}

export async function updateQuestion(idToken: string, testId: string, question: QuestionData): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.updateQuestion(user, testId, parseQuestion(question)));
}

export async function deleteQuestion(idToken: string, testId: string, questionId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.deleteQuestion(user, testId, String(questionId)));
}

export async function reorderQuestions(idToken: string, testId: string, orderedIds: string[]): Promise<ActionResult> {
  return withUser(idToken, (user) => {
    const ids = z.array(z.string().min(1).max(200)).max(MAX_QUESTIONS_PER_SAVE * 10).parse(orderedIds);
    return repo.reorderQuestions(user, testId, ids);
  });
}

export async function deleteTest(idToken: string, testId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.deleteTest(user, testId));
}

export async function listVersions(idToken: string, testId: string): Promise<ActionResult<TestVersionSummary[]>> {
  return withUser(idToken, (user) => repo.listVersions(user, testId));
}

export async function restoreVersion(idToken: string, testId: string, version: number): Promise<ActionResult<number>> {
  return withUser(idToken, (user) => {
    if (!Number.isInteger(version) || version < 1) throw new UserFacingError('Invalid version.');
    return repo.restoreVersion(user, testId, version);
  });
}
