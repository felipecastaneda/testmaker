import "server-only";
import { AuthError, requireUser, type AuthedUser } from "./auth";
import type { ActionResult } from "@/lib/types";

/** Errors whose message is safe and useful to show the user. */
export class UserFacingError extends Error {}

/**
 * Run a server action body for an authenticated, allow-listed user and convert
 * failures into a serialisable result. (Thrown errors are redacted by Next.js in
 * production, so we never let them escape.)
 */
export async function withUser<T>(
  idToken: string,
  fn: (user: AuthedUser) => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const user = await requireUser(idToken);
    return { success: true, data: await fn(user) };
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: false, error: error.message, code: error.code };
    }
    if (error instanceof UserFacingError) {
      return { success: false, error: error.message };
    }
    console.error("Server action failed:", error);
    return { success: false, error: "Something went wrong. Please try again." };
  }
}
