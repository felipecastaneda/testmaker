"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Building2, Loader2 } from "lucide-react";
import { Navbar } from "@/components/TestMaker/Navbar";
import { useAuth } from "@/components/auth/AuthProvider";
import { FullCardSpinner, SignInCard, VerifyEmailCard } from "@/components/auth/AuthScreens";
import { Button } from "@/components/ui/button";
import { acceptInvite, getInvite } from "@/app/actions/members";
import { useCourses } from "@/hooks/use-courses";
import type { InviteInfo } from "@/lib/types";

const ROLE_LABELS: Record<string, string> = {
  owner: "an owner",
  admin: "an admin",
  instructor: "an instructor",
  assistant: "an assistant",
};

/**
 * Accepting an invite. Invitees usually aren't on the allow-list, so this page only
 * needs a verified email; joining the institution is what grants access to the app.
 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const auth = useAuth();
  const { reload: reloadCourses } = useCourses();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const verified = !!auth.user?.emailVerified;
  const { callAction } = auth;

  useEffect(() => {
    if (!verified) return;
    let cancelled = false;
    callAction((t) => getInvite(t, token)).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setInvite(result.data);
      else setError(result.error ?? "Couldn't load this invite.");
    });
    return () => {
      cancelled = true;
    };
  }, [verified, token, callAction]);

  const accept = async () => {
    setAccepting(true);
    const result = await callAction((t) => acceptInvite(t, token));
    if (!result.success) {
      setAccepting(false);
      setError(result.error ?? "Couldn't accept the invite.");
      return;
    }
    // Membership is what lets an invitee through the signup gate, so re-check access.
    await auth.refreshAccount();
    await reloadCourses();
    router.push("/");
  };

  let body: React.ReactNode;
  if (auth.loading) body = <FullCardSpinner />;
  else if (!auth.user) {
    body = (
      <div className="space-y-4">
        <p className="text-center text-sm text-slate-600">
          You&apos;ve been invited to TestMaker. Sign in, or create an account <strong>with the email the invite was sent to</strong>.
        </p>
        <SignInCard />
      </div>
    );
  } else if (!verified) body = <VerifyEmailCard />;
  else if (error) {
    body = (
      <div className="text-center space-y-3">
        <AlertCircle className="mx-auto h-10 w-10 text-rose-400" />
        <p className="text-slate-700">{error}</p>
      </div>
    );
  } else if (!invite) body = <FullCardSpinner />;
  else if (invite.status !== "valid") {
    body = (
      <div className="text-center space-y-3">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
        <h2 className="text-xl font-bold text-slate-800">Invite unavailable</h2>
        <p className="text-slate-600">{invite.message}</p>
      </div>
    );
  } else {
    body = (
      <div className="text-center space-y-5 max-w-md mx-auto">
        <Building2 className="mx-auto h-12 w-12 text-primary" />
        <h2 className="text-2xl font-bold font-headline text-slate-800">Join {invite.orgName}</h2>
        <p className="text-slate-600">
          You&apos;ve been invited to join <strong>{invite.orgName}</strong> as {ROLE_LABELS[invite.role] ?? invite.role}.
        </p>
        {invite.emailMatches ? (
          <Button size="lg" className="rounded-full px-8" onClick={accept} disabled={accepting}>
            {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept invite"}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              This invite is for <strong>{invite.email}</strong>, but you&apos;re signed in as <strong>{auth.user.email}</strong>.
            </p>
            <Button variant="outline" onClick={auth.signOut}>
              Sign in with another account
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-16">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow p-8 md:p-10">{body}</div>
      </main>
    </div>
  );
}
