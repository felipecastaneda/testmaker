import "server-only";
import { adminAuth } from "./admin";
import { serverConfig } from "./config";
import { getPlatformConfig } from "./platform";
import { hasInstitutionMembership } from "./workspace";

export type AuthErrorCode = "unauthenticated" | "unverified" | "forbidden";

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface AuthedUser {
  uid: string;
  email: string;
}

/**
 * Whether a verified user may use the app at all. Any one of these is enough:
 * the ALLOWED_EMAILS env var, signup mode "open" or the allow-list in _meta/platform,
 * or membership of an institution (someone invited them). A personal org doesn't count,
 * because every signed-in user gets one.
 */
async function passesSignupGate(uid: string, email: string): Promise<boolean> {
  if (serverConfig.allowedEmails.has(email) || serverConfig.platformAdminEmails.has(email)) return true;
  const platform = await getPlatformConfig();
  if (platform.signupMode === "open" || platform.allowedEmails.has(email)) return true;
  return hasInstitutionMembership(uid);
}

export function isPlatformAdmin(user: AuthedUser): boolean {
  return serverConfig.platformAdminEmails.has(user.email);
}

/**
 * Verify a Firebase ID token: signed in with a verified email. Does NOT apply the signup
 * gate, so only use it for actions an invitee needs before they have access (accepting
 * an invite). Everything else goes through requireUser().
 */
export async function requireVerifiedUser(idToken: string | null | undefined): Promise<AuthedUser> {
  if (!idToken) throw new AuthError("unauthenticated", "Please sign in.");

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken, true);
  } catch {
    throw new AuthError("unauthenticated", "Your session has expired. Please sign in again.");
  }

  const email = decoded.email?.toLowerCase();
  if (!email) throw new AuthError("forbidden", "Your account has no email address.");
  if (!decoded.email_verified) {
    throw new AuthError("unverified", "Please verify your email address first.");
  }
  return { uid: decoded.uid, email };
}

/**
 * Verify a Firebase ID token and enforce the access policy:
 * signed in, email verified, and allowed through the signup gate.
 */
export async function requireUser(idToken: string | null | undefined): Promise<AuthedUser> {
  const user = await requireVerifiedUser(idToken);
  if (!(await passesSignupGate(user.uid, user.email))) {
    throw new AuthError("forbidden", "This account isn't on the access list for TestMaker.");
  }
  return user;
}
