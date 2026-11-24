'use server';

import { z } from 'zod';
import { AVAILABLE_MODELS } from '@/ai/models';
import type { SettingsPatch } from '@/lib/settings/resolve';
import type { ActionResult, SettingsOverview } from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import * as repo from '@/server/settings-repo';
import { ensureUserWorkspace } from '@/server/workspace';

const Id = z.string().min(1).max(200).regex(/^[^/]+$/);
const modelIds = AVAILABLE_MODELS.map((m) => m.id) as [string, ...string[]];
// Values are validated per key against the registry in validateSettingsPatch.
const Patch = z.object({
  values: z.record(z.string().max(100), z.unknown()).refine((v) => Object.keys(v).length <= 50, 'Too many settings.'),
  locked: z.array(z.string().max(100)).max(50).optional(),
});
const OrgChange = z.object({
  name: z.string().trim().min(1, 'Please give the organization a name.').max(80, 'Names are limited to 80 characters.').optional(),
  settings: Patch.optional(),
});
const Prefs = z.object({
  selectedModels: z.array(z.enum(modelIds)).min(1, 'Choose at least one model.').max(modelIds.length),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserFacingError(result.error.issues[0]?.message ?? 'Invalid input.');
  return result.data;
}

export async function getSettings(idToken: string): Promise<ActionResult<SettingsOverview>> {
  return withUser(idToken, async (user) => {
    await ensureUserWorkspace(user);
    return repo.getSettingsOverview(user);
  });
}

export async function updateOrg(
  idToken: string,
  orgId: string,
  change: { name?: string; settings?: SettingsPatch }
): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.updateOrg(user, parse(Id, orgId), parse(OrgChange, change)));
}

export async function updateCourseSettings(idToken: string, courseId: string, settings: SettingsPatch): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.updateCourseSettings(user, parse(Id, courseId), parse(Patch, settings)));
}

export async function updatePrefs(idToken: string, prefs: { selectedModels: string[] }): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.updatePrefs(user, parse(Prefs, prefs)));
}
