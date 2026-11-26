"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, Clock, GraduationCap, Loader2 } from "lucide-react";
import { getExam, getExamInfo, joinExam } from "@/app/actions/take";
import { ExamRunner } from "@/components/take/ExamRunner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeJoinCode } from "@/lib/assignments";
import type { PublicAssignmentInfo, StudentExamView } from "@/lib/exam-types";
import { formatPoints } from "@/lib/question-utils";
import { signInStudentWithGoogle, signOutStudent, studentIdToken, type StudentAccount } from "@/lib/student-auth";
import { domainHint, emailAllowed } from "@/lib/student-identity";

/** The browser remembers the attempt per exam code, so students can resume after a refresh. */
const storageKey = (code: string) => `testmaker:attempt:${code}`;

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "join"; info: PublicAssignmentInfo }
  | { kind: "exam"; token: string; view: StudentExamView };

export default function TakeExamPage() {
  const params = useParams<{ code: string }>();
  const code = normalizeJoinCode(decodeURIComponent(params.code));
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = localStorage.getItem(storageKey(code));
      if (saved) {
        const exam = await getExam(saved);
        if (cancelled) return;
        if (exam.success && exam.data) return setPhase({ kind: "exam", token: saved, view: exam.data });
        localStorage.removeItem(storageKey(code));
      }
      const info = await getExamInfo(code);
      if (cancelled) return;
      setPhase(info.success && info.data ? { kind: "join", info: info.data } : { kind: "error", message: info.error ?? "Couldn't find this exam." });
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 h-14 flex items-center gap-2">
          <div className="bg-primary p-1.5 rounded-lg">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-primary font-headline">TestMaker</span>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          {phase.kind === "loading" && (
            <div className="flex justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {phase.kind === "error" && (
            <div className="bg-white rounded-2xl shadow-sm p-8 text-center space-y-3">
              <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
              <p className="text-slate-700">{phase.message}</p>
              <Button variant="outline" asChild>
                <Link href="/take">Enter a different code</Link>
              </Button>
            </div>
          )}
          {phase.kind === "join" && (
            <JoinForm
              code={code}
              info={phase.info}
              onJoined={(token, view) => {
                localStorage.setItem(storageKey(code), token);
                setPhase({ kind: "exam", token, view });
              }}
            />
          )}
          {phase.kind === "exam" && <ExamRunner token={phase.token} initial={phase.view} />}
        </div>
      </main>
    </div>
  );
}

function JoinForm({
  code,
  info,
  onJoined,
}: {
  code: string;
  info: PublicAssignmentInfo;
  onJoined: (token: string, view: StudentExamView) => void;
}) {
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<StudentAccount | null>(null);
  const open = info.availability === "open";
  const google = info.identity === "google";
  const needsId = !google || info.askStudentId;

  const signIn = async () => {
    setError(null);
    try {
      const signedIn = await signInStudentWithGoogle(info.allowedDomains);
      if (!signedIn) return;
      if (!emailAllowed(signedIn.email, info.allowedDomains)) {
        await signOutStudent();
        setError(`Use your ${domainHint(info.allowedDomains)} account; ${signedIn.email} can't take this exam.`);
        return;
      }
      setAccount(signedIn);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const idToken = google ? ((await studentIdToken()) ?? account?.idToken ?? null) : null;
    const result = await joinExam(code, name, studentId, idToken);
    setBusy(false);
    if (result.success && result.data) {
      // The exam runs on its attempt token; the Google session isn't needed any more.
      if (google) await signOutStudent();
      onJoined(result.data.token, result.data.view);
    } else setError(result.error ?? "Couldn't start the exam.");
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-10 max-w-lg mx-auto space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold font-headline text-slate-800">{info.title}</h1>
        <p className="text-sm text-muted-foreground">
          {info.questionCount} questions · {formatPoints(info.totalPoints)}
        </p>
        {info.timeLimitMinutes && (
          <p className="text-sm text-slate-600 inline-flex items-center gap-1">
            <Clock className="h-4 w-4" /> You&apos;ll have {info.timeLimitMinutes} minutes once you start.
          </p>
        )}
        {info.closesAt && <p className="text-xs text-muted-foreground">Closes {new Date(info.closesAt).toLocaleString()}</p>}
      </div>

      {!open ? (
        <p className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="exam-unavailable">
          {info.availability === "closed"
            ? "This exam is closed."
            : info.availability === "scheduled" && info.opensAt
              ? `This exam opens ${new Date(info.opensAt).toLocaleString()}.`
              : "This exam isn't open yet. Check with your professor."}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {google ? (
            account ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm" data-testid="student-account">
                <span>
                  <span className="font-medium text-slate-800 block">{account.name || account.email}</span>
                  <span className="text-xs text-muted-foreground">{account.email}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await signOutStudent();
                    setAccount(null);
                  }}
                >
                  Use another account
                </Button>
              </div>
            ) : (
              <div className="space-y-2 text-center">
                <Button type="button" variant="outline" size="lg" className="w-full" onClick={signIn}>
                  Sign in with Google
                </Button>
                <p className="text-xs text-muted-foreground">
                  {info.allowedDomains.length ? `Use your ${domainHint(info.allowedDomains)} account.` : "Use your school Google account."}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="student-name" className="text-sm font-medium">
                Full name
              </label>
              <Input id="student-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
            </div>
          )}
          {needsId && (!google || account) && (
            <div className="space-y-1.5">
              <label htmlFor="student-id" className="text-sm font-medium">
                Student ID
              </label>
              <Input id="student-id" value={studentId} onChange={(e) => setStudentId(e.target.value)} maxLength={40} autoComplete="off" required />
            </div>
          )}
          {error && (
            <p className="text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}
          {(!google || account) && (
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={busy || (!google && !name.trim()) || (needsId && !studentId.trim())}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start exam"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground text-center">
            You get one attempt.{" "}
            {google ? "If you change devices, sign in again to continue where you left off. " : ""}
            {info.timeLimitMinutes ? "The timer starts when you click Start." : ""}
          </p>
        </form>
      )}
    </div>
  );
}
