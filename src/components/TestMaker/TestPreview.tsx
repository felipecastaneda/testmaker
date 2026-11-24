"use client";

import React, { useMemo, useState } from "react";
import { ArrowLeft, ClipboardCheck, FileDown, GraduationCap, History, PencilRuler, RefreshCw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/AuthProvider";
import { deleteQuestion, reorderQuestions, updateQuestion } from "@/app/actions/tests";
import { toast } from "@/hooks/use-toast";
import { formatPoints, orderOptions, totalPoints } from "@/lib/question-utils";
import { shuffle } from "@/lib/utils";
import type { QuestionData } from "@/lib/types";
import { QuestionCard, type ViewMode } from "./QuestionCard";
import { ExportDialog } from "./ExportDialog";
import { VersionHistoryDialog } from "./VersionHistoryDialog";

interface TestPreviewProps {
  questions: QuestionData[];
  setQuestions: React.Dispatch<React.SetStateAction<QuestionData[]>>;
  onReset: () => void;
  /** Firestore id. When set, changes are saved back to the library. */
  testId?: string | null;
  testName?: string;
  version?: number;
  /** Reload the test from the server (after restoring a version). */
  onReload?: () => void;
}

export function TestPreview({ questions, setQuestions, onReset, testId, testName, version, onReload }: TestPreviewProps) {
  const { callAction } = useAuth();
  const [mode, setMode] = useState<ViewMode>("author");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const title = testName?.trim() || "Untitled Test";

  // Derived from current data so edits show immediately; the seed keeps the order
  // stable across renders and changes only when a new attempt starts.
  const optionsById = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const q of questions) map[q.id] = orderOptions(q, `attempt:${attempt}`);
    return map;
  }, [questions, attempt]);

  const score = useMemo(() => {
    const right = questions.filter((q) => answers[q.id] === q.correctAnswer);
    const correct = right.length;
    const answered = questions.filter((q) => answers[q.id] !== undefined).length;
    const total = questions.length;
    // The percentage is weighted by points, like a real grade.
    const earned = totalPoints(right);
    const possible = totalPoints(questions);
    return {
      correct,
      answered,
      total,
      earned,
      possible,
      incorrect: answered - correct,
      unanswered: total - answered,
      percentage: possible === 0 ? 0 : Math.round((earned / possible) * 100),
    };
  }, [questions, answers]);

  const startAttempt = (nextMode: ViewMode = mode) => {
    setAnswers({});
    setSubmitted(false);
    setAttempt((a) => a + 1);
    setMode(nextMode);
  };

  const saveQuestion = async (updated: QuestionData): Promise<string | null> => {
    if (testId) {
      const result = await callAction((token) => updateQuestion(token, testId, updated));
      if (!result.success) return result.error ?? "Couldn't save your changes.";
    }
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    toast({ title: "Question updated", description: testId ? "Saved to your library." : "Not saved to the library." });
    return null;
  };

  const removeQuestion = async (q: QuestionData) => {
    if (!confirm(`Delete question "${q.question.slice(0, 80)}${q.question.length > 80 ? "…" : ""}"?`)) return;
    if (testId) {
      const result = await callAction((token) => deleteQuestion(token, testId, q.id));
      if (!result.success) {
        toast({ title: "Couldn't delete question", description: result.error, variant: "destructive" });
        return;
      }
    }
    setQuestions((prev) => prev.filter((x) => x.id !== q.id));
    toast({ title: "Question deleted" });
  };

  const shuffleOrder = async () => {
    const reordered = shuffle(questions);
    if (testId) {
      const result = await callAction((token) => reorderQuestions(token, testId, reordered.map((q) => q.id)));
      if (!result.success) {
        toast({ title: "Couldn't save the new order", description: result.error, variant: "destructive" });
        return;
      }
    }
    setQuestions(reordered);
    toast({ title: "Order randomized" });
  };

  const submit = () => {
    if (score.unanswered > 0 && !confirm(`${score.unanswered} question(s) are unanswered. Submit anyway?`)) return;
    setSubmitted(true);
    requestAnimationFrame(() => {
      document.getElementById("test-results")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-1">
          <button type="button" onClick={onReset} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="h-3 w-3" /> Back to start
          </button>
          <h2 className="text-2xl font-bold font-headline text-primary flex items-center gap-2">
            {title}
            {version && testId && <Badge variant="secondary" className="text-xs">v{version}</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">
            {questions.length} question{questions.length === 1 ? "" : "s"} ·{" "}
            <span data-testid="total-points">{formatPoints(totalPoints(questions))}</span> ·{" "}
            {testId ? "Changes are saved to your library automatically." : "Not saved to your library."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200" role="tablist" aria-label="View mode">
            {([
              { id: "author", label: "Edit & review", icon: PencilRuler },
              { id: "student", label: "Take test", icon: GraduationCap },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                onClick={() => startAttempt(id)}
                className={`flex flex-1 items-center justify-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${mode === id ? "bg-white shadow-sm text-primary" : "text-slate-500 hover:text-slate-700"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
          {mode === "author" ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={shuffleOrder} disabled={questions.length < 2} className="rounded-full">
                <Shuffle className="h-4 w-4 mr-2" /> Shuffle
              </Button>
              {testId && (
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} className="rounded-full">
                  <History className="h-4 w-4 mr-2" /> History
                </Button>
              )}
              <Button size="sm" onClick={() => setExportOpen(true)} disabled={questions.length === 0} className="rounded-full">
                <FileDown className="h-4 w-4 mr-2" /> Export
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => startAttempt("student")} className="rounded-full">
              <RefreshCw className="h-4 w-4 mr-2" /> Restart
            </Button>
          )}
        </div>
      </div>

      {mode === "student" && !submitted && (
        <p className="text-sm text-muted-foreground bg-primary/5 border border-primary/10 rounded-xl px-4 py-3">
          Answer every question, then submit to see your score. Answered {score.answered} of {score.total}.
        </p>
      )}

      <div className="grid gap-6">
        {questions.length === 0 && (
          <div className="py-20 text-center text-muted-foreground bg-white rounded-xl border-2 border-dashed">
            No questions yet. Go back and generate some.
          </div>
        )}
        {questions.map((q, idx) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={idx}
            mode={mode}
            options={optionsById[q.id] ?? []}
            selected={answers[q.id]}
            submitted={submitted}
            onSelect={(option) => setAnswers((prev) => ({ ...prev, [q.id]: option }))}
            onSave={saveQuestion}
            onDelete={() => removeQuestion(q)}
          />
        ))}
      </div>

      {mode === "student" && !submitted && questions.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={submit} className="rounded-full px-8 h-12 text-base shadow-lg">
            <ClipboardCheck className="h-5 w-5 mr-2" /> Submit answers
          </Button>
        </div>
      )}

      {mode === "student" && submitted && (
        <div id="test-results" className="bg-white rounded-2xl shadow-2xl p-8 border-2 border-primary animate-in zoom-in-95 duration-500">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128" aria-hidden="true">
                <circle cx="64" cy="64" r="58" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                <circle
                  cx="64"
                  cy="64"
                  r="58"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeDasharray={364.42}
                  strokeDashoffset={364.42 - (364.42 * score.percentage) / 100}
                  className="text-primary transition-all duration-1000"
                />
              </svg>
              <span className="absolute text-3xl font-black text-slate-800" data-testid="score-percentage">
                {score.percentage}%
              </span>
            </div>
            <div className="flex-1 space-y-2 text-center md:text-left">
              <h3 className="text-3xl font-black text-slate-800 font-headline">Test Results</h3>
              <p className="text-lg text-slate-500">
                You correctly answered <span className="font-bold text-primary">{score.correct}</span> out of{" "}
                <span className="font-bold text-slate-700">{score.total}</span> questions.
              </p>
              <p className="text-sm text-slate-500" data-testid="score-points">
                {formatPoints(score.earned).replace(/ pts?$/, "")} of {formatPoints(score.possible)}
              </p>
              <div className="flex flex-wrap gap-2 pt-2 justify-center md:justify-start">
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">{score.correct} Correct</Badge>
                <Badge className="bg-rose-100 text-rose-700 border-rose-200">{score.incorrect} Incorrect</Badge>
                {score.unanswered > 0 && <Badge className="bg-slate-100 text-slate-600 border-slate-200">{score.unanswered} Unanswered</Badge>}
              </div>
            </div>
            <Button onClick={() => startAttempt("student")} variant="outline" className="rounded-full h-12 px-6">
              <RefreshCw className="h-4 w-4 mr-2" /> Try again
            </Button>
          </div>
        </div>
      )}

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} title={title} questions={questions} />
      {testId && (
        <VersionHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          testId={testId}
          currentVersion={version}
          onRestored={() => onReload?.()}
        />
      )}
    </div>
  );
}
