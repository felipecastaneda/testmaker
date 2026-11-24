'use server';

import { z } from 'zod';
import type { ActionResult, CourseRole, CourseStaffView, InviteInfo, OrgMembersView, OrgRole } from '@/lib/types';
import { ORG_ROLES } from '@/lib/permissions';
import { UserFacingError, withUser, withVerifiedUser } from '@/server/action-result';
import { isPlatformAdmin } from '@/server/auth';
import * as repo from '@/server/members-repo';
import { getPlatformConfig, updatePlatformConfig, type SignupMode } from '@/server/platform';

const Id = z.string().min(1).max(200).regex(/^[^/]+$/);
const Token = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/, 'This invite link isn\'t valid.');
const Email = z.string().trim().toLowerCase().email('Please enter a valid email address.').max(254);
const Role = z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]);
const StaffRole = z.enum(['instructor', 'assistant']).nullable();
const Name = z.string().trim().min(1, 'Please enter a name.').max(80, 'Names are limited to 80 characters.');

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UserFacingError(result.error.issues[0]?.message ?? 'Invalid input.');
  return result.data;
}

// Institutions and the active organization ---------------------------------

export async function createInstitution(idToken: string, name: string): Promise<ActionResult<string>> {
  return withUser(idToken, (user) => repo.createInstitution(user, parse(Name, name)));
}

export async function setActiveOrg(idToken: string, orgId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.setActiveOrg(user, parse(Id, orgId)));
}

// Members and invites -------------------------------------------------------

export async function getOrgMembers(idToken: string, orgId: string): Promise<ActionResult<OrgMembersView>> {
  return withUser(idToken, (user) => repo.getOrgMembers(user, parse(Id, orgId)));
}

export async function updateMemberRole(idToken: string, orgId: string, uid: string, role: OrgRole): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.updateMemberRole(user, parse(Id, orgId), parse(Id, uid), parse(Role, role)));
}

export async function removeMember(idToken: string, orgId: string, uid: string): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.removeMember(user, parse(Id, orgId), parse(Id, uid)));
}

/** Returns the secret token; the client turns it into a link. It is never shown again. */
export async function createInvite(
  idToken: string,
  orgId: string,
  email: string,
  role: OrgRole
): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  return withUser(idToken, (user) => repo.createInvite(user, parse(Id, orgId), parse(Email, email), parse(Role, role)));
}

export async function revokeInvite(idToken: string, orgId: string, inviteId: string): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.revokeInvite(user, parse(Id, orgId), parse(Id, inviteId)));
}

// The invitee isn't through the signup gate yet, so these only need a verified email.

export async function getInvite(idToken: string, token: string): Promise<ActionResult<InviteInfo>> {
  return withVerifiedUser(idToken, (user) => repo.getInvite(user, parse(Token, token)));
}

export async function acceptInvite(idToken: string, token: string): Promise<ActionResult<{ orgId: string }>> {
  return withVerifiedUser(idToken, (user) => repo.acceptInvite(user, parse(Token, token)));
}

// Course staff --------------------------------------------------------------

export async function getCourseStaff(idToken: string, courseId: string): Promise<ActionResult<CourseStaffView>> {
  return withUser(idToken, (user) => repo.getCourseStaff(user, parse(Id, courseId)));
}

export async function setCourseStaff(idToken: string, courseId: string, uid: string, role: CourseRole | null): Promise<ActionResult> {
  return withUser(idToken, (user) => repo.setCourseStaff(user, parse(Id, courseId), parse(Id, uid), parse(StaffRole, role)));
}

// Platform (platform admins only) --------------------------------------------

export interface PlatformView {
  signupMode: SignupMode;
  allowedEmails: string[];
}

export async function getPlatform(idToken: string): Promise<ActionResult<PlatformView>> {
  return withUser(idToken, async (user) => {
    if (!isPlatformAdmin(user)) throw new UserFacingError('Only platform admins can see this.');
    const config = await getPlatformConfig();
    return { signupMode: config.signupMode, allowedEmails: [...config.allowedEmails].sort() };
  });
}

export async function updatePlatform(idToken: string, change: PlatformView): Promise<ActionResult> {
  return withUser(idToken, async (user) => {
    if (!isPlatformAdmin(user)) throw new UserFacingError('Only platform admins can change this.');
    const parsed = parse(
      z.object({ signupMode: z.enum(['allowlist', 'open']), allowedEmails: z.array(Email).max(5_000) }),
      change
    );
    await updatePlatformConfig(parsed);
  });
}
