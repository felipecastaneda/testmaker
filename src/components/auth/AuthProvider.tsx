"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { clientAuth } from "@/lib/firebase";
import { getAccountStatus, type AccountStatus } from "@/app/actions/generate";
import type { ActionResult } from "@/lib/types";

type AccessState =
  | { status: "unknown" }
  | { status: "allowed"; account: AccountStatus }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  access: AccessState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-check whether the user has clicked the verification link. */
  refreshVerification: () => Promise<boolean>;
  refreshAccount: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Call a server action with a fresh ID token. Signs the user out if the server
   * reports the session is no longer valid.
   */
  callAction: <T>(fn: (idToken: string) => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const FRIENDLY_ERRORS: Record<string, string> = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/invalid-email": "That email address isn't valid.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/weak-password": "Please choose a password with at least 8 characters.",
  "auth/too-many-requests": "Too many attempts. Please wait a minute and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
};

export function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  return FRIENDLY_ERRORS[code] ?? "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<AccessState>({ status: "unknown" });

  const checkAccess = useCallback(async (u: User) => {
    try {
      const result = await getAccountStatus(await u.getIdToken());
      if (result.success && result.data) {
        setAccess({ status: "allowed", account: result.data });
      } else if (result.code === "forbidden" || result.code === "unverified") {
        setAccess({ status: "forbidden", message: result.error ?? "Access denied." });
      } else {
        setAccess({ status: "error", message: result.error ?? "Couldn't check your access." });
      }
    } catch {
      setAccess({ status: "error", message: "Couldn't reach the server. Please try again." });
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(clientAuth(), (u) => {
      setUser(u);
      setLoading(false);
      setAccess({ status: "unknown" });
      if (u?.emailVerified) void checkAccess(u);
    });
  }, [checkAccess]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(clientAuth());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      access,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(clientAuth(), email.trim(), password);
      },
      signUp: async (email, password) => {
        const cred = await createUserWithEmailAndPassword(clientAuth(), email.trim(), password);
        await sendEmailVerification(cred.user);
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(clientAuth(), email.trim());
      },
      resendVerification: async () => {
        const current = clientAuth().currentUser;
        if (current) await sendEmailVerification(current);
      },
      refreshVerification: async () => {
        const current = clientAuth().currentUser;
        if (!current) return false;
        await current.reload();
        if (!current.emailVerified) return false;
        // Force a new token so the server sees the email_verified claim.
        await current.getIdToken(true);
        setUser(clientAuth().currentUser);
        await checkAccess(current);
        return true;
      },
      refreshAccount: async () => {
        const current = clientAuth().currentUser;
        if (current) await checkAccess(current);
      },
      signOut,
      callAction: async (fn) => {
        const current = clientAuth().currentUser;
        if (!current) return { success: false, error: "Please sign in.", code: "unauthenticated" };
        const result = await fn(await current.getIdToken());
        if (result.code === "unauthenticated") await signOut();
        return result;
      },
    }),
    [user, loading, access, checkAccess, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
