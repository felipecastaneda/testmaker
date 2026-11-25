"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Clock, Loader2, X, XCircle } from "lucide-react";
import { getExam, saveExamAnswer, submitExam } from "@/app/actions/take";
import { Button } from "@/components/ui/button";
import type { StudentExamView } from "@/lib/exam-types";
import { formatPoints, optionLetter } from "@/lib/question-utils";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A student's exam: answer, autosave, countdown, submit, and results when released. */
export function ExamRunner({ token, initial }: { token: string; initial: StudentExamView }) {
  const [view, setView] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, string>>(initial.answers);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  // Server time minus local time, so a wrong clock on the student's device doesn't matter.
  const [offset, setOffset] = useState(() => Date.parse(initial.serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  const pending = useRef(0);
  const autoSubmitted = useRef(false);

  const refresh = useCallback(async () => {
    const result = await getExam(token);
    if (result.success && result.data) {
      setOffset(Date.parse(result.data.serverNow) - Date.now());
      setView(result.data);
      setAnswers(result.data.answers);
    }
  }, [token]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    const result = await submitExam(token);
    setSubmitting(false);
    if (result.success && result.data) setView(result.data);
    else setSave({ kind: "error", message: result.error ?? "Couldn't submit. Check your connection and try again." });
  }, [token]);

  const inProgress = view.status === "in_progress";
  const remaining = view.deadline ? Date.parse(view.deadline) - now : null;

  useEffect(() => {
    if (!inProgress || !view.deadline) return;
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [inProgress, view.deadline, offset]);

  // Time's up: check the server first (the professor may have given extra time), then
  // submit whatever has been saved (the server would anyway).
  useEffect(() => {
    if (!inProgress || remaining === null || remaining > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void (async () => {
      const fresh = await getExam(token);
      if (fresh.success && fresh.data) {
        const serverNow = Date.parse(fresh.data.serverNow);
        if (fresh.data.status === "in_progress" && fresh.data.deadline && Date.parse(fresh.data.deadline) > serverNow) {
          setOffset(serverNow - Date.now());
          setView(fresh.data);
          autoSubmitted.current = false;
          return;
        }
      }
      await submit();
    })();
  }, [inProgress, remaining, submit, token]);

  const choose = async (questionId: string, option: string) => {
    if (!inProgress) return;
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
    pending.current += 1;
    setSave({ kind: "saving" });
    const result = await saveExamAnswer(token, questionId, option);
    pending.current -= 1;
    if (!result.success) {
      setSave({ kind: "error", message: result.error ?? "Couldn't save your answer. Check your connection." });
      // Submitted or closed elsewhere: show the real state.
      if (/submitted|closed|valid/i.test(result.error ?? "")) await refresh();
      return;
    }
    if (pending.current === 0) setSave({ kind: "saved" });
  };

  const answered = view.questions.filter((q) => answers[q.id] !== undefined).length;

  const confirmSubmit = () => {
    const missing = view.questions.length - answered;
    const message = missing > 0 ? `You haven't answered ${missing} question(s). Submit anyway?` : "Submit your answers? You can't change them afterwards.";
    if (confirm(message)) void submit();
  };

  if (!inProgress) return <Submitted view={view} />;

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold font-headline text-slate-800 truncate">{view.title}</h1>
          <p className="text-xs text-muted-foreground">
            {view.studentName} · {answered} of {view.questions.length} answered
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite" data-testid="save-status">
            {save.kind === "saving" && "Saving…"}
            {save.kind === "saved" && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="h-3 w-3" /> All answers saved
              </span>
            )}
            {save.kind === "error" && <span className="text-rose-600">{save.message}</span>}
          </span>
          {remaining !== null && (
            <span
              className={`inline-flex items-center gap-1 font-mono text-sm font-semibold px-2 py-1 rounded-md ${remaining < 60_000 ? "bg-rose-100 text-rose-700" : "bg-white border border-slate-200 text-slate-700"}`}
              aria-label="Time remaining"
              data-testid="time-remaining"
            >
              <Clock className="h-3.5 w-3.5" /> {formatRemaining(remaining)}
            </span>
          )}
        </div>
      </div>

      <ol className="space-y-5">
        {view.questions.map((q, i) => (
          <li key={q.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6 space-y-4" data-testid="exam-question">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-slate-800 leading-relaxed whitespace-pre-line">
                <span className="text-slate-400 mr-1">{i + 1}.</span> {q.question}
              </h2>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatPoints(q.points)}</span>
            </div>
            {q.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={q.imageUrl} alt={`Diagram for question ${i + 1}`} className="max-h-72 rounded-lg border" />
            )}
            <div role="radiogroup" aria-label={`Answers for question ${i + 1}`} className="grid gap-2">
              {q.options.map((option, oi) => {
                const selected = answers[q.id] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(q.id, option)}
                    className={`flex items-center gap-3 w-full text-left rounded-xl border px-4 py-3 text-sm transition-all ${selected ? "bg-primary/5 border-primary ring-1 ring-primary" : "border-slate-200 hover:border-primary/50 hover:bg-primary/5"}`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full border-2 text-xs font-bold shrink-0 ${selected ? "bg-primary border-primary text-white" : "border-slate-200 text-slate-400"}`}
                    >
                      {optionLetter(oi)}
                    </span>
                    {option}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col items-center gap-2 pb-12">
        <Button size="lg" className="rounded-full px-10" onClick={confirmSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit answers"}
        </Button>
        <p className="text-xs text-muted-foreground">Your answers are saved as you go. You can close this page and come back on this device.</p>
      </div>
    </div>
  );
}

function Submitted({ view }: { view: StudentExamView }) {
  const result = view.result;
  return (
    <div className="space-y-6 pb-12">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sm:p-8 text-center space-y-3">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h1 className="text-2xl font-bold font-headline text-slate-800">{view.title}</h1>
        <p className="text-slate-600">
          {view.submittedBy === "deadline"
            ? "The exam ended (time ran out or it was closed), so your saved answers were submitted."
            : "Your answers were submitted."}
          {view.submittedAt && <span className="block text-xs text-muted-foreground mt-1">{new Date(view.submittedAt).toLocaleString()}</span>}
        </p>
        {result?.released ? (
          <p className="text-3xl font-black text-slate-800" data-testid="student-score">
            {formatPoints(result.earned).replace(/ pts?$/, "")} / {formatPoints(result.possible)} · {result.percentage}%
          </p>
        ) : (
          <p className="text-sm text-slate-500 flex items-center justify-center gap-1.5" data-testid="results-pending">
            <AlertCircle className="h-4 w-4" /> {result && !result.released ? result.message : "Results aren't available yet."}
          </p>
        )}
      </div>

      {result?.released && (
        <ol className="space-y-4" aria-label="Your answers">
          {result.questions.map((q, i) => (
            <li key={q.id} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-2" data-testid="result-question">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-slate-800">
                  <span className="text-slate-400 mr-1">{i + 1}.</span> {q.question}
                </h2>
                <span className={`text-xs font-semibold whitespace-nowrap ${q.correct ? "text-emerald-700" : "text-rose-600"}`}>
                  {formatPoints(q.earned).replace(/ pts?$/, "")} / {formatPoints(q.points)}
                </span>
              </div>
              <p className="flex items-center gap-1.5 text-sm">
                {q.correct ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}
                Your answer: <span className="font-medium">{q.yourAnswer ?? "Not answered"}</span>
              </p>
              {q.correctAnswer && !q.correct && (
                <p className="flex items-center gap-1.5 text-sm text-emerald-800">
                  <Check className="h-4 w-4" /> Correct answer: <span className="font-medium">{q.correctAnswer}</span>
                </p>
              )}
              {q.explanation && <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{q.explanation}</p>}
            </li>
          ))}
        </ol>
      )}
      {!result?.released && (
        <p className="text-center text-xs text-muted-foreground">
          <X className="inline h-3 w-3" /> You can close this page. Come back to this link later on this device to see your results.
        </p>
      )}
    </div>
  );
}
