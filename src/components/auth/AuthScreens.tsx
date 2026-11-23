"use client";

import React, { useState } from "react";
import { Loader2, LogOut, MailCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { friendlyAuthError, useAuth } from "./AuthProvider";

type Mode = "signin" | "signup" | "reset";

export function SignInCard() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "signup" && password.length < 8) {
      setError("Please choose a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else if (mode === "signup") await signUp(email, password);
      else {
        await resetPassword(email);
        setNotice("If an account exists for that email, a password reset link is on its way.");
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="max-w-sm mx-auto space-y-6">
      <div className="space-y-1 text-center">
        <h2 className="text-2xl font-bold font-headline text-slate-800">
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create an account" : "Reset password"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {mode === "reset" ? "We'll email you a link to choose a new password." : "TestMaker is invite-only. Use the email you were invited with."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="auth-email">Email</Label>
          <Input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== "reset" && (
          <div className="space-y-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full rounded-full" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2 text-sm">
        {mode === "signin" ? (
          <>
            <button type="button" className="text-primary hover:underline" onClick={() => switchMode("signup")}>
              New here? Create an account
            </button>
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => switchMode("reset")}>
              Forgot your password?
            </button>
          </>
        ) : (
          <button type="button" className="text-primary hover:underline" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

export function VerifyEmailCard() {
  const { user, resendVerification, refreshVerification, signOut } = useAuth();
  const [busy, setBusy] = useState<"check" | "resend" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const check = async () => {
    setBusy("check");
    setMessage(null);
    try {
      const verified = await refreshVerification();
      if (!verified) setMessage("Not verified yet. Click the link in the email, then try again.");
    } catch (err) {
      setMessage(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend");
    setMessage(null);
    try {
      await resendVerification();
      setMessage("Verification email sent.");
    } catch (err) {
      setMessage(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-sm mx-auto space-y-5 text-center">
      <MailCheck className="h-12 w-12 mx-auto text-primary" />
      <div className="space-y-1">
        <h2 className="text-2xl font-bold font-headline text-slate-800">Verify your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to <span className="font-medium text-slate-700">{user?.email}</span>. Click it, then continue.
        </p>
      </div>
      {message && <p className="text-sm text-slate-600">{message}</p>}
      <div className="flex flex-col gap-2">
        <Button className="rounded-full" onClick={check} disabled={busy !== null}>
          {busy === "check" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          I&apos;ve verified my email
        </Button>
        <Button variant="outline" className="rounded-full" onClick={resend} disabled={busy !== null}>
          {busy === "resend" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Resend email
        </Button>
        <Button variant="ghost" className="rounded-full" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Use a different account
        </Button>
      </div>
    </div>
  );
}

export function AccessProblemCard({ message, retry }: { message: string; retry?: () => void }) {
  const { user, signOut } = useAuth();
  return (
    <div className="max-w-sm mx-auto space-y-5 text-center">
      <ShieldAlert className="h-12 w-12 mx-auto text-rose-500" />
      <div className="space-y-1">
        <h2 className="text-2xl font-bold font-headline text-slate-800">No access</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        {user?.email && <p className="text-xs text-muted-foreground">Signed in as {user.email}</p>}
      </div>
      <div className="flex flex-col gap-2">
        {retry && (
          <Button className="rounded-full" onClick={retry}>
            Try again
          </Button>
        )}
        <Button variant="outline" className="rounded-full" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>
    </div>
  );
}

export function FullCardSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-8 w-8 text-primary animate-spin" />
    </div>
  );
}
