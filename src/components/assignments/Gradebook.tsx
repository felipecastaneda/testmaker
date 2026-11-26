"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Download, Eye, EyeOff, Loader2, Minus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { extendAttempt, getGradebook, getPaperScan, regradeQuestion, resetAttempt, setResultsReleased } from "@/app/actions/assignments";
import type { PaperScanView } from "@/server/paper-repo";
import { ScanSheetView } from "./ScanSheetView";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { downloadBlob, fileSafeName } from "@/lib/exporters";
import {
  averagePercent,
  missingStudents,
  versionAverages,
  gradebookCsv,
  minutesTaken,
  questionStats,
  type GradebookAttempt,
  type GradebookQuestion,
  type GradebookView,
} from "@/lib/gradebook";
import { percentage } from "@/lib/grading";
import { formatPoints } from "@/lib/question-utils";
import type { ActionResult, AssignmentSummary } from "@/lib/types";

interface GradebookProps {
  assignmentId: string;
  /** Called with fresh assignment data (counts, release state) whenever the gradebook loads. */
  onAssignment: (a: AssignmentSummary) => void;
}

const statusLabel = (a: GradebookAttempt) =>
  a.status === "in_progress" ? "In progress" : a.submittedBy === "deadline" ? "Submitted (time/close)" : "Submitted";

export function Gradebook({ assignmentId, onAssignment }: GradebookProps) {
  const { callAction } = useAuth();
  const [view, setView] = useState<GradebookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regrading, setRegrading] = useState<GradebookQuestion | null>(null);
  const [viewing, setViewing] = useState<GradebookAttempt | null>(null);

  const load = useCallback(async () => {
    const result = await callAction((t) => getGradebook(t, assignmentId));
    if (result.success && result.data) {
      setView(result.data);
      setError(null);
      onAssignment(result.data.assignment);
    } else setError(result.error ?? "Couldn't load the gradebook.");
  }, [callAction, assignmentId, onAssignment]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (run: (token: string) => Promise<ActionResult<unknown>>, success: string) => {
    setBusy(true);
    const result = await callAction(run);
    setBusy(false);
    if (!result.success) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: success });
    await load();
  };

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;

  const { assignment: a, questions, attempts } = view;
  const stats = questionStats(questions, attempts);
  const average = averagePercent(attempts);
  const submitted = attempts.filter((x) => x.status === "submitted").length;
  const isPaper = a.delivery === "paper";
  const rows = [...attempts].sort((x, y) => x.studentName.localeCompare(y.studentName) || x.studentId.localeCompare(y.studentId));
  const canRelease = a.canEdit && !isPaper && a.resultsRelease !== "immediately";

  const exportCsv = () =>
    downloadBlob(new Blob([gradebookCsv(view)], { type: "text/csv;charset=utf-8" }), `${fileSafeName(a.title)}_grades.csv`);

  const extend = (attempt: GradebookAttempt) => {
    const input = prompt(`Extra minutes for ${attempt.studentName}?`, "10");
    const minutes = Number(input);
    if (!input || !Number.isInteger(minutes) || minutes < 1) return;
    void act((t) => extendAttempt(t, assignmentId, attempt.id, minutes), `${attempt.studentName} has ${minutes} more minutes`);
  };

  const reset = (attempt: GradebookAttempt) => {
    if (isPaper) {
      if (!confirm(`Delete the answers entered for ${attempt.studentName || attempt.studentId}? You can enter them again.`)) return;
      void act((t) => resetAttempt(t, assignmentId, attempt.id), "Answers deleted");
      return;
    }
    if (
      !confirm(
        `Reset ${attempt.studentName}'s attempt (${attempt.studentId})? Their answers and grade are deleted and they can start again. Use this if they switched devices or someone else used their ID.`
      )
    )
      return;
    void act((t) => resetAttempt(t, assignmentId, attempt.id), "Attempt reset");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600" data-testid="gradebook-summary">
          {isPaper ? `${attempts.length} answer ${attempts.length === 1 ? "sheet" : "sheets"} entered` : `${submitted} submitted · ${attempts.length - submitted} in progress`}
          {average !== null && ` · average ${average}%`}
        </p>
        <div className="flex flex-wrap gap-2">
          {canRelease && (
            <Button
              variant={a.resultsReleased ? "outline" : "default"}
              size="sm"
              disabled={busy}
              onClick={() =>
                act(
                  (t) => setResultsReleased(t, assignmentId, !a.resultsReleased),
                  a.resultsReleased ? "Results hidden from students" : "Results released to students"
                )
              }
            >
              {a.resultsReleased ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
              {a.resultsReleased ? "Hide results" : "Release results"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={attempts.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={busy} aria-label="Refresh gradebook">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {isPaper && <PaperSummary attempts={attempts} classList={view.classList} />}
      {canRelease && (
        <p className="text-xs text-muted-foreground">
          {a.resultsReleased
            ? "Students can see their results now."
            : a.resultsRelease === "after_close"
              ? "Students see their results when the assignment closes, or now if you release them."
              : "Students see their results only after you release them."}
        </p>
      )}

      {attempts.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">{isPaper ? "No answers entered yet." : "No students have started yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm" aria-label="Gradebook">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Student</th>
                <th className="text-left font-semibold px-3 py-2">{isPaper ? "Version" : "Status"}</th>
                <th className="text-right font-semibold px-3 py-2">Score</th>
                {!isPaper && (
                  <>
                    <th className="text-right font-semibold px-3 py-2">Time</th>
                    <th className="text-right font-semibold px-3 py-2" title="Times the student left the exam page (switched tab or app). Information only.">
                      Left page
                    </th>
                  </>
                )}
                {questions.map((q, i) => {
                  const s = stats[q.id];
                  return (
                    <th key={q.id} className="px-1 py-2 font-semibold text-center min-w-[52px]">
                      <button
                        type="button"
                        disabled={!a.canEdit}
                        onClick={() => setRegrading(q)}
                        className={`rounded px-1.5 py-0.5 ${a.canEdit ? "hover:bg-slate-200" : "cursor-default"}`}
                        title={`${q.question}\nCorrect: ${q.correctAnswer}${q.accepted.length ? " (regraded)" : ""}${a.canEdit ? "\nClick to regrade" : ""}`}
                        aria-label={`Question ${i + 1}: ${s.percentCorrect ?? "–"}% correct${a.canEdit ? ", regrade" : ""}`}
                      >
                        Q{i + 1}
                        {q.accepted.length > 0 && <span className="text-amber-600">*</span>}
                        <span className="block font-normal text-[10px]" data-testid={`q-stat-${i + 1}`}>
                          {s.percentCorrect === null ? "–" : `${s.percentCorrect}%`}
                        </span>
                      </button>
                    </th>
                  );
                })}
                {a.canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((attempt) => {
                const g = attempt.status === "submitted" ? attempt.grade : null;
                return (
                  <tr key={attempt.id} data-testid="gradebook-row">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-800">{attempt.studentName || attempt.studentId}</span>
                      {attempt.studentName && <span className="block text-xs text-muted-foreground">{attempt.studentId}</span>}
                      {attempt.email && attempt.email !== attempt.studentId && (
                        <span className="block text-xs text-muted-foreground" data-testid="row-email">
                          {attempt.email}
                        </span>
                      )}
                    </td>
                    {isPaper ? (
                      <td className="px-3 py-2 text-xs whitespace-nowrap" data-testid="row-version">
                        <span className="font-semibold">{attempt.variant}</span>
                        <span className="text-muted-foreground"> · {attempt.entry === "scan" ? "scanned" : "typed"}</span>
                        {attempt.hasScan && (
                          <button
                            type="button"
                            className="ml-2 text-primary hover:underline"
                            onClick={() => setViewing(attempt)}
                            aria-label={`View scan for ${attempt.studentName || attempt.studentId}`}
                          >
                            View scan
                          </button>
                        )}
                      </td>
                    ) : (
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {statusLabel(attempt)}
                        {attempt.extended && attempt.status === "in_progress" && (
                          <span className="block text-amber-700">extra time until {new Date(attempt.deadline!).toLocaleTimeString()}</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right whitespace-nowrap" data-testid="row-score">
                      {g ? `${formatPoints(g.earned).replace(/ pts?$/, "")} / ${formatPoints(g.possible)} (${percentage(g.earned, g.possible)}%)` : "–"}
                    </td>
                    {!isPaper && (
                      <>
                        <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                          {minutesTaken(attempt) !== null ? `${minutesTaken(attempt)} min` : ""}
                        </td>
                        <td className="px-3 py-2 text-right text-xs whitespace-nowrap" data-testid="row-left-page">
                          {attempt.focusLosses > 0 ? <span className="text-amber-700 font-medium">{attempt.focusLosses}×</span> : <span className="text-slate-300">0</span>}
                        </td>
                      </>
                    )}
                    {questions.map((q) => {
                      const answer = attempt.answers[q.id];
                      const cell = g?.perQuestion[q.id];
                      return (
                        <td key={q.id} className="px-1 py-2 text-center" title={answer ?? "Not answered"}>
                          {!g ? (
                            answer !== undefined ? <span className="text-slate-400">•</span> : <Minus className="inline h-3 w-3 text-slate-300" />
                          ) : cell?.correct ? (
                            <Check className="inline h-4 w-4 text-emerald-600" aria-label="correct" />
                          ) : answer === undefined ? (
                            <Minus className="inline h-3 w-3 text-slate-400" aria-label="not answered" />
                          ) : (
                            <X className="inline h-4 w-4 text-rose-500" aria-label="wrong" />
                          )}
                        </td>
                      );
                    })}
                    {a.canEdit && (
                      <td className="px-2 py-2 whitespace-nowrap text-right">
                        {attempt.status === "in_progress" && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => extend(attempt)} disabled={busy} aria-label={`Extra time for ${attempt.studentName}`}>
                            <Clock className="h-3.5 w-3.5 mr-1" /> Time
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-500 hover:text-rose-600" onClick={() => reset(attempt)} disabled={busy} aria-label={`${isPaper ? "Delete" : "Reset"} ${attempt.studentName || attempt.studentId}`}>
                          {isPaper ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <ScanDialog assignmentId={assignmentId} attempt={viewing} onClose={() => setViewing(null)} />}
      {regrading && (
        <RegradeDialog
          question={regrading}
          index={questions.findIndex((q) => q.id === regrading.id)}
          choices={stats[regrading.id]?.choices ?? {}}
          onClose={() => setRegrading(null)}
          onSave={async (accepted) => {
            setRegrading(null);
            await act((t) => regradeQuestion(t, assignmentId, regrading.id, accepted), "Question regraded; grades updated");
          }}
        />
      )}
    </div>
  );
}

function RegradeDialog({
  question,
  index,
  choices,
  onClose,
  onSave,
}: {
  question: GradebookQuestion;
  index: number;
  choices: Record<string, number>;
  onClose: () => void;
  onSave: (accepted: string[]) => void;
}) {
  const [fullCredit, setFullCredit] = useState(question.accepted.includes("*"));
  const [accepted, setAccepted] = useState<string[]>(question.accepted.filter((o) => o !== "*"));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Regrade question {index + 1}</DialogTitle>
          <DialogDescription>{question.question}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2" disabled={fullCredit}>
          <legend className="text-sm font-medium mb-1">Count as correct</legend>
          {question.options.map((option) => {
            const isKey = option === question.correctAnswer;
            return (
              <label key={option} className="flex items-center justify-between gap-3 text-sm rounded-lg border border-slate-100 px-3 py-2">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isKey || fullCredit || accepted.includes(option)}
                    disabled={isKey}
                    onChange={(e) => setAccepted(e.target.checked ? [...accepted, option] : accepted.filter((o) => o !== option))}
                  />
                  {option}
                  {isKey && <span className="text-xs text-emerald-700">(answer key)</span>}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{choices[option] ?? 0} chose this</span>
              </label>
            );
          })}
        </fieldset>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={fullCredit} onChange={(e) => setFullCredit(e.target.checked)} />
          Give everyone full credit (e.g. the question was flawed)
        </label>
        <p className="text-xs text-muted-foreground">Every submitted grade is recalculated. Students who haven&apos;t finished are graded with these rules too.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(fullCredit ? ["*"] : accepted)}>Save and regrade</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScanDialog({ assignmentId, attempt, onClose }: { assignmentId: string; attempt: GradebookAttempt; onClose: () => void }) {
  const { callAction } = useAuth();
  const [scan, setScan] = useState<PaperScanView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callAction((t) => getPaperScan(t, assignmentId, attempt.id)).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setScan(result.data);
      else setError(result.error ?? "Couldn't load the scan.");
    });
    return () => {
      cancelled = true;
    };
  }, [callAction, assignmentId, attempt.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {attempt.studentName || attempt.studentId} · Version {attempt.variant}
          </DialogTitle>
          <DialogDescription>The scanned sheet, with the answers that were counted circled in green.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : !scan ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <div data-testid="scan-view">
            <ScanSheetView
              src={scan.dataUrl}
              width={scan.width}
              height={scan.height}
              corners={scan.corners}
              paper={scan.paper}
              optionCounts={scan.optionCounts}
              letters={scan.letters}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Paper exams: averages per version, and who on the class list has no answers yet. */
function PaperSummary({ attempts, classList }: { attempts: GradebookAttempt[]; classList: GradebookView["classList"] }) {
  const versions = versionAverages(attempts);
  const missing = missingStudents(classList, attempts);
  if (versions.length < 2 && !classList.length) return null;
  return (
    <div className="text-xs text-slate-600 space-y-1">
      {versions.length > 1 && (
        <p data-testid="version-averages">
          By version: {versions.map((v) => `${v.variant} ${v.average}% (${v.count})`).join(" · ")}
        </p>
      )}
      {classList.length > 0 &&
        (missing.length ? (
          <details>
            <summary className="cursor-pointer text-amber-700" data-testid="missing-students">
              {missing.length} of {classList.length} students on the class list have no answers yet
            </summary>
            <p className="mt-1">{missing.map((m) => (m.name ? `${m.name} (${m.id})` : m.id)).join(", ")}</p>
          </details>
        ) : (
          <p className="text-emerald-700" data-testid="missing-students">
            Everyone on the class list ({classList.length}) has answers entered.
          </p>
        ))}
    </div>
  );
}
