import "server-only";
import { adminAuth } from "./admin";
import { serverConfig } from "./config";

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
 * Verify a Firebase ID token and enforce the access policy:
 * signed in, email verified, and email on the ALLOWED_EMAILS allow-list.
 */
export async function requireUser(idToken: string | null | undefined): Promise<AuthedUser> {
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
  if (!serverConfig.allowedEmails.has(email)) {
    throw new AuthError("forbidden", "This account isn't on the access list for TestMaker.");
  }
  return { uid: decoded.uid, email };
}
