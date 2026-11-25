"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, Loader2, Lock, Pencil, Play, Square, Trash2 } from "lucide-react";
import { Navbar } from "@/components/TestMaker/Navbar";
import { useAccessGate } from "@/components/auth/AccessGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { AssignmentForm, RESULTS_RELEASE_LABELS } from "@/components/assignments/AssignmentForm";
import { AvailabilityBadge, formatWhen } from "@/components/assignments/AvailabilityBadge";
import { Gradebook } from "@/components/assignments/Gradebook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteAssignment, getAssignment, updateAssignment } from "@/app/actions/assignments";
import { toast } from "@/hooks/use-toast";
import { useCourses } from "@/hooks/use-courses";
import { formatPoints } from "@/lib/question-utils";
import type { AssignmentOptions, AssignmentStatus, AssignmentSummary } from "@/lib/types";

const AVAILABILITY_HELP = {
  draft: "Students can't start yet. Open it when you're ready.",
  scheduled: "It opens automatically at the scheduled time.",
  open: "Students can join with the link or code below.",
  closed: "Students can't start or continue. You can reopen it.",
};

export default function AssignmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ready, gate } = useAccessGate();
  const { callAction } = useAuth();
  const { overview } = useCourses();
  const [assignment, setAssignment] = useState<AssignmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ options: AssignmentOptions | null; problem: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const load = useCallback(async () => {
    const result = await callAction((t) => getAssignment(t, id));
    if (result.success && result.data) setAssignment(result.data);
    else setError(result.error ?? "Couldn't load this assignment.");
  }, [callAction, id]);

  useEffect(() => {
    // Data fetching once access is confirmed; state updates happen after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready) void load();
  }, [ready, load]);

  const save = async (patch: Partial<AssignmentOptions> & { status?: AssignmentStatus }, success: string) => {
    setBusy(true);
    const result = await callAction((t) => updateAssignment(t, id, patch));
    setBusy(false);
    if (!result.success || !result.data) {
      toast({ title: "Couldn't update the assignment", description: result.error, variant: "destructive" });
      return false;
    }
    setAssignment(result.data);
    toast({ title: success });
    return true;
  };

  const remove = async () => {
    if (!confirm("Delete this assignment? Every student attempt and grade in it is deleted too. The test itself stays in your library.")) return;
    setBusy(true);
    const result = await callAction((t) => deleteAssignment(t, id));
    setBusy(false);
    if (!result.success) {
      toast({ title: "Couldn't delete", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Assignment deleted" });
    router.push("/assignments");
  };

  const copy = async (what: "link" | "code", text: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(what);
  };

  const a = assignment;
  const link = a && typeof window !== "undefined" ? `${window.location.origin}/take/${a.joinCode}` : "";
  const courseName = a ? overview?.courses.find((c) => c.id === a.courseId)?.name : undefined;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <Link href="/assignments" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-3 w-3" /> All assignments
          </Link>
          {gate ? (
            <div className="bg-white rounded-2xl shadow p-6 md:p-10">{gate}</div>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : !a ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold font-headline text-slate-800">{a.title}</h1>
                    <AvailabilityBadge availability={a.availability} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {courseName ? `${courseName} · ` : ""}
                    {a.questionCount} questions · {formatPoints(a.totalPoints)} · from test version {a.testVersion}
                  </p>
                  <p className="text-sm text-slate-600">{AVAILABILITY_HELP[a.availability]}</p>
                </div>
                {a.canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {a.status !== "open" ? (
                      <Button onClick={() => save({ status: "open" }, "Assignment opened")} disabled={busy}>
                        <Play className="h-4 w-4 mr-1" /> Open now
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => save({ status: "closed" }, "Assignment closed")} disabled={busy}>
                        <Square className="h-4 w-4 mr-1" /> Close now
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => { setEditing(true); setDraft(null); }} disabled={busy || editing}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" className="text-slate-500 hover:text-rose-600" onClick={remove} disabled={busy}>
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </div>
                )}
              </div>

              <section className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4" aria-label="Share with students">
                <h2 className="text-lg font-semibold text-slate-800">Share with students</h2>
                <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-end">
                  <div className="space-y-1.5">
                    <label htmlFor="join-link" className="text-sm font-medium">
                      Link
                    </label>
                    <div className="flex gap-2">
                      <Input id="join-link" readOnly value={link} className="text-xs" onFocus={(e) => e.target.select()} />
                      <Button variant="outline" onClick={() => copy("link", link)} aria-label="Copy link">
                        {copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium block">Join code</span>
                    <button
                      type="button"
                      onClick={() => copy("code", a.joinCode)}
                      className="font-mono text-2xl font-bold tracking-[0.25em] px-4 py-1.5 rounded-lg bg-slate-900 text-white"
                      title="Copy code"
                      data-testid="join-code"
                    >
                      {a.joinCode}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Students open the link (or go to <span className="font-mono">/take</span> and type the code), then enter their name and student ID.
                </p>
              </section>

              {editing ? (
                <section className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4" aria-label="Edit assignment">
                  <h2 className="text-lg font-semibold text-slate-800">Edit</h2>
                  <AssignmentForm initial={a} onChange={(options, problem) => setDraft({ options, problem })} />
                  {draft?.problem && <p className="text-sm text-rose-600" role="alert">{draft.problem}</p>}
                  <p className="text-xs text-muted-foreground">
                    Changes apply to students who start from now on. Questions can&apos;t be edited here: they&apos;re a frozen copy of the test.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy || !draft?.options}
                      onClick={async () => {
                        if (draft?.options && (await save(draft.options, "Assignment saved"))) setEditing(false);
                      }}
                    >
                      Save changes
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </section>
              ) : (
                <section className="bg-white rounded-2xl border border-slate-100 p-6" aria-label="Settings">
                  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <Detail label="Opens" value={a.opensAt ? formatWhen(a.opensAt) : "When you open it"} />
                    <Detail label="Closes" value={a.closesAt ? formatWhen(a.closesAt) : "When you close it"} />
                    <Detail label="Time limit" value={a.timeLimitMinutes ? `${a.timeLimitMinutes} minutes` : "None"} />
                    <Detail label="Attempts" value="1 per student" />
                    <Detail label="Results" value={RESULTS_RELEASE_LABELS[a.resultsRelease]} />
                    <Detail label="Correct answers" value={a.showCorrectAnswers ? "Shown with results" : "Not shown"} />
                    <Detail label="Question order" value={a.shuffleQuestions ? "Shuffled per student" : "Same for everyone"} />
                    <Detail label="Answer order" value="Shuffled per student" />
                  </dl>
                </section>
              )}

              <section className="bg-white rounded-2xl border border-slate-100 p-6 space-y-3" aria-label="Students">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">Grades</h2>
                  <p className="text-xs text-slate-500" data-testid="assignment-stats">
                    {a.stats.started} started · {a.stats.submitted} submitted
                  </p>
                </div>
                {!a.canEdit && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Lock className="h-3 w-3" /> You can view this assignment but not change it.
                  </p>
                )}
                <Gradebook key={a.status} assignmentId={a.id} onAssignment={setAssignment} />
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
