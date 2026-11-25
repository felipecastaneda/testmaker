'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import type { JoinResult, PublicAssignmentInfo, StudentExamView } from '@/lib/exam-types';
import type { ActionResult } from '@/lib/types';
import * as repo from '@/server/attempts-repo';
import { UserFacingError } from '@/server/errors';

/*
 * Student-facing actions. Students have no account: these take no Firebase token and
 * never pass the professor signup gate. Each one is limited to the assignment found by
 * its join code, or to the single attempt its token names.
 */

const Token = z.string().min(30).max(400);

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    if (error instanceof UserFacingError) return { success: false, error: error.message };
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0]?.message ?? 'Invalid input.' };
    console.error('Student action failed:', error);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function getExamInfo(code: string): Promise<ActionResult<PublicAssignmentInfo>> {
  return run(() => repo.getPublicInfo(z.string().max(40).parse(code)));
}

export async function joinExam(code: string, name: string, studentId: string): Promise<ActionResult<JoinResult>> {
  return run(async () => {
    const userAgent = (await headers()).get('user-agent') ?? '';
    return repo.joinAssignment(z.string().max(40).parse(code), z.string().max(200).parse(name), z.string().max(200).parse(studentId), userAgent);
  });
}

export async function getExam(token: string): Promise<ActionResult<StudentExamView>> {
  return run(() => repo.getExamView(Token.parse(token)));
}

export async function saveExamAnswer(token: string, questionId: string, option: string | null): Promise<ActionResult> {
  return run(() =>
    repo.saveAnswer(Token.parse(token), z.string().min(1).max(200).parse(questionId), z.string().max(2_000).nullable().parse(option))
  );
}

export async function submitExam(token: string): Promise<ActionResult<StudentExamView>> {
  return run(() => repo.submitAttempt(Token.parse(token)));
}
