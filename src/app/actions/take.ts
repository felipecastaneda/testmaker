'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import type { JoinResult, PublicAssignmentInfo, StudentExamView } from '@/lib/exam-types';
import { clientIpFrom, RateLimiter } from '@/lib/rate-limit';
import type { ActionResult } from '@/lib/types';
import * as repo from '@/server/attempts-repo';
import { UserFacingError } from '@/server/errors';

/*
 * Student-facing actions. Students have no account: these take no Firebase token and
 * never pass the professor signup gate. Each one is limited to the assignment found by
 * its join code, or to the single attempt its token names.
 *
 * Rate limits are per server instance and generous, because a whole school often shares
 * one IP address. The per-assignment student limit is the hard guard.
 */

const Token = z.string().min(30).max(400);
const Code = z.string().max(40);

const limits = {
  /** Everything a student does, per IP: stops floods, never a real class. */
  all: new RateLimiter(3_000, 60_000),
  /** Looking up a code, per IP: makes guessing codes impractical. */
  lookup: new RateLimiter(60, 60_000),
  /** Joining one assignment, per IP. */
  join: new RateLimiter(300, 10 * 60_000),
};

const TOO_MANY = 'Too many requests from your network. Wait a minute and try again.';

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom(h.get('x-forwarded-for'), h.get('x-real-ip'));
}

async function run<T>(fn: (ip: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ip = await clientIp();
    if (!limits.all.allow(ip)) return { success: false, error: TOO_MANY };
    return { success: true, data: await fn(ip) };
  } catch (error) {
    if (error instanceof UserFacingError) return { success: false, error: error.message };
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0]?.message ?? 'Invalid input.' };
    console.error('Student action failed:', error);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function getExamInfo(code: string): Promise<ActionResult<PublicAssignmentInfo>> {
  return run((ip) => {
    if (!limits.lookup.allow(ip)) throw new UserFacingError(TOO_MANY);
    return repo.getPublicInfo(Code.parse(code));
  });
}

export async function joinExam(code: string, name: string, studentId: string): Promise<ActionResult<JoinResult>> {
  return run(async (ip) => {
    const parsedCode = Code.parse(code);
    if (!limits.join.allow(`${ip}:${parsedCode.toUpperCase()}`)) throw new UserFacingError(TOO_MANY);
    const userAgent = (await headers()).get('user-agent') ?? '';
    return repo.joinAssignment(parsedCode, z.string().max(200).parse(name), z.string().max(200).parse(studentId), userAgent);
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

/** The student switched away from the exam (tab, window, app). Informational only. */
export async function recordFocusLoss(token: string): Promise<ActionResult> {
  return run(() => repo.recordFocusLoss(Token.parse(token)));
}
