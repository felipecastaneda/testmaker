'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AVAILABLE_MODELS, getModelOption } from '@/ai/models';
import { normalizeGeneratedQuestions, type RawGeneratedQuestion } from '@/ai/normalize';
import { MAX_CHUNK_CHARS, MAX_QUESTIONS_PER_BATCH } from '@/lib/generation';
import type { ActionResult, QuestionData } from '@/lib/types';
import { UserFacingError, withUser } from '@/server/action-result';
import { serverConfig } from '@/server/config';
import { fakeGenerate } from '@/server/fake-ai';
import { getDailyUsage, releaseDailyQuota, reserveDailyQuota } from '@/server/tests-repo';
import { getGenerationSettings, getSelectedModelsPref } from '@/server/settings-repo';
import { isPlatformAdmin } from '@/server/auth';
import { canCreateInstitutions } from '@/server/members-repo';
import { ensureUserWorkspace, requireCourseAccess } from '@/server/workspace';

const modelIds = AVAILABLE_MODELS.map((m) => m.id) as [string, ...string[]];

const BatchSchema = z.object({
  chunk: z.string().trim().min(50, 'The document is too short.').max(MAX_CHUNK_CHARS + 1_000),
  count: z.number().int().min(1).max(MAX_QUESTIONS_PER_BATCH),
  model: z.enum(modelIds),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
  questionTypes: z.array(z.enum(['multiple_choice', 'true_false'])).min(1).max(2),
  instructions: z.string().max(2_000).optional().default(''),
  /** The course the test is for; its settings apply. Defaults to the user's "My tests". */
  courseId: z.string().min(1).max(200).optional(),
});
export type GenerateBatchInput = z.input<typeof BatchSchema>;

export interface AccountStatus {
  email: string;
  dailyLimit: number;
  usedToday: number;
  /** The user's preferred models, or null if never chosen. */
  selectedModels: string[] | null;
  isPlatformAdmin: boolean;
  canCreateInstitutions: boolean;
}

/**
 * Confirms the signed-in user may use the app, sets up their personal workspace on
 * first sign-in, and reports their quota.
 */
export async function getAccountStatus(idToken: string): Promise<ActionResult<AccountStatus>> {
  return withUser(idToken, async (user) => {
    const [usedToday, , selectedModels, institutions] = await Promise.all([
      getDailyUsage(user.uid),
      ensureUserWorkspace(user),
      getSelectedModelsPref(user.uid),
      canCreateInstitutions(user),
    ]);
    return {
      email: user.email,
      dailyLimit: serverConfig.dailyQuestionLimit,
      usedToday,
      selectedModels,
      isPlatformAdmin: isPlatformAdmin(user),
      canCreateInstitutions: institutions,
    };
  });
}

/**
 * Generate up to `count` complete questions (with distractors) from one document chunk.
 * The client splits long documents and calls this once per batch so it can show progress.
 */
export async function generateQuestionBatch(
  idToken: string,
  input: GenerateBatchInput
): Promise<ActionResult<QuestionData[]>> {
  return withUser(idToken, async (user) => {
    const parsed = BatchSchema.safeParse(input);
    if (!parsed.success) {
      throw new UserFacingError(parsed.error.issues[0]?.message ?? 'Invalid generation request.');
    }
    const req = parsed.data;

    const courseId = req.courseId ?? (await ensureUserWorkspace(user)).defaultCourseId;
    const { orgId } = await requireCourseAccess(user, courseId, 'edit');
    const settings = await getGenerationSettings(orgId, courseId);
    if (!settings.allowedModels.includes(req.model)) {
      throw new UserFacingError(`${getModelOption(req.model)?.label ?? req.model} isn't enabled for this organization.`);
    }
    // Organization and course instructions come first; the author's own request last.
    const instructions = [...settings.instructions, req.instructions].filter(Boolean).join('\n\n');

    await reserveDailyQuota(user.uid, req.count, serverConfig.dailyQuestionLimit);

    let raw: RawGeneratedQuestion[];
    try {
      if (serverConfig.fakeAi) {
        raw = fakeGenerate(req.chunk, req.count, req.questionTypes, req.model, instructions);
      } else {
        // Imported lazily so Genkit and the provider SDKs only load when actually needed.
        const { generateQuestionSetFlow } = await import('@/ai/flows/generate-question-set');
        const output = await generateQuestionSetFlow({
          documentChunk: req.chunk,
          numberOfQuestions: req.count,
          model: req.model,
          difficulty: req.difficulty,
          allowMultipleChoice: req.questionTypes.includes('multiple_choice'),
          allowTrueFalse: req.questionTypes.includes('true_false'),
          specialInstructions: instructions || undefined,
        });
        raw = output.questions;
      }
    } catch (error) {
      console.error(`Generation failed for ${req.model}:`, error);
      await releaseDailyQuota(user.uid, req.count);
      throw new UserFacingError(`${getModelOption(req.model)?.label ?? req.model} couldn't generate questions.`);
    }

    const questions = normalizeGeneratedQuestions(raw, {
      sourceText: req.chunk,
      count: req.count,
      questionTypes: req.questionTypes,
      difficulty: req.difficulty,
    });

    // Only charge for what was actually produced.
    if (questions.length < req.count) {
      await releaseDailyQuota(user.uid, req.count - questions.length);
    }

    return questions.map((q) => ({ ...q, id: randomUUID(), sourceModel: req.model }));
  });
}
