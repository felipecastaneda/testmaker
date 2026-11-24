"use client";

import type React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AccessProblemCard, FullCardSpinner, SignInCard, VerifyEmailCard } from "@/components/auth/AuthScreens";

/**
 * What to show instead of the app while the user isn't signed in, verified and allowed.
 * `gate` is null once the user may use the app.
 */
export function useAccessGate(): { ready: boolean; gate: React.ReactNode } {
  const auth = useAuth();
  const ready = !!auth.user?.emailVerified && auth.access.status === "allowed";
  let gate: React.ReactNode = null;
  if (auth.loading) gate = <FullCardSpinner />;
  else if (!auth.user) gate = <SignInCard />;
  else if (!auth.user.emailVerified) gate = <VerifyEmailCard />;
  else if (auth.access.status === "unknown") gate = <FullCardSpinner />;
  else if (auth.access.status === "forbidden") gate = <AccessProblemCard message={auth.access.message} />;
  else if (auth.access.status === "error") gate = <AccessProblemCard message={auth.access.message} retry={auth.refreshAccount} />;
  return { ready, gate };
}
