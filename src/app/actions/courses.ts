'use server';

import { z } from 'zod';
import type { ActionResult, CourseInput, CourseSummary, CoursesOverview } from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import * as courses from '@/server/courses-repo';
import { moveTest as moveTestInRepo } from '@/server/tests-repo';
import { ensureUserWorkspace } from '@/server/workspace';

const Id = z.string().min(1).max(200).regex(/^[^/]+$/);
const CourseFields = z.object({
  name: z.string().trim().min(1, 'Please give the course a name.').max(120, 'Course names are limited to 120 characters.'),
  code: z.string().trim().max(40, 'Course codes are limited to 40 characters.').optional(),
  term: z.string().trim().max(40, 'Terms are limited to 40 characters.').optional(),
});
const CoursePatch = CourseFields.partial().extend({ archived: z.boolean().optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserFacingError(result.error.issues[0]?.message ?? 'Invalid input.');
  return result.data;
}

/** The user's organizations and every course they can see. */
export async function listCourses(idToken: string): Promise<ActionResult<CoursesOverview>> {
  return withUser(idToken, async (user) => {
    await ensureUserWorkspace(user);
    return courses.getCoursesOverview(user);
  });
}

export async function createCourse(idToken: string, orgId: string, input: CourseInput): Promise<ActionResult<CourseSummary>> {
  return withUser(idToken, (user) => courses.createCourse(user, parse(Id, orgId), parse(CourseFields, input)));
}

export async function updateCourse(
  idToken: string,
  courseId: string,
  patch: Partial<CourseInput> & { archived?: boolean }
): Promise<ActionResult> {
  return withUser(idToken, (user) => courses.updateCourse(user, parse(Id, courseId), parse(CoursePatch, patch)));
}

export async function deleteCourse(idToken: string, courseId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => courses.deleteCourse(user, parse(Id, courseId)));
}

export async function moveTest(idToken: string, testId: string, targetCourseId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => moveTestInRepo(user, parse(Id, testId), parse(Id, targetCourseId)));
}
