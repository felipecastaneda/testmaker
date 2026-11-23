"use client";

import React, { useMemo, useState } from "react";
import { Download, Edit2, Check, X, RefreshCw, Trash2, FileDown, Shuffle, Plus, ArrowLeft, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { updateTestQuestions } from "@/app/actions/save-test";
import { toast } from "@/hooks/use-toast";
import { getModelOption } from "@/ai/models";
import { seededShuffle, shuffle } from "@/lib/utils";
import type { QuestionData } from "@/lib/types";

export type { QuestionData };

interface TestPreviewProps {
  questions: QuestionData[];
  setQuestions: React.Dispatch<React.SetStateAction<QuestionData[]>>;
  onReset: () => void;
  /** Firestore document id. When set, edits are saved back to the library. */
  testId?: string | null;
  testName?: string;
}

const letter = (index: number) => String.fromCharCode(65 + index);

function slugify(name: string) {
  return name.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "TestMaker_Exam";
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function TestPreview({ questions, setQuestions, onReset, testId, testName }: TestPreviewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuestionData | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [showGrade, setShowGrade] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Options are derived from the current question data, so edits are reflected immediately.
  // The seeded shuffle keeps the order stable across renders and only changes per attempt.
  const optionsById = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const q of questions) {
      map[q.id] = seededShuffle([q.correctAnswer, ...q.distractors], `${q.id}:${attempt}`);
    }
    return map;
  }, [questions, attempt]);

  const score = useMemo(() => {
    const correct = questions.filter((q) => selectedAnswers[q.id] === q.correctAnswer).length;
    const answered = questions.filter((q) => selectedAnswers[q.id] !== undefined).length;
    const total = questions.length;
    return {
      correct,
      answered,
      total,
      incorrect: answered - correct,
      unanswered: total - answered,
      percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
    };
  }, [questions, selectedAnswers]);

  /** Apply a change locally and, when the test lives in the library, save it. */
  const commit = async (updated: QuestionData[], successTitle: string, successDescription: string) => {
    setQuestions(updated);
    if (!testId) {
      toast({ title: successTitle, description: `${successDescription} (not saved to the library)` });
      return;
    }
    const result = await updateTestQuestions(testId, updated);
    if (result.success) {
      toast({ title: successTitle, description: successDescription });
    } else {
      toast({
        title: "Couldn't save changes",
        description: "Your change is visible here but wasn't saved to the library.",
        variant: "destructive",
      });
    }
  };

  const startEditing = (q: QuestionData) => {
    setEditingId(q.id);
    setDraft({ ...q, distractors: [...q.distractors] });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEditing = async () => {
    if (!draft) return;
    const cleaned: QuestionData = {
      ...draft,
      question: draft.question.trim(),
      correctAnswer: draft.correctAnswer.trim(),
      distractors: draft.distractors.map((d) => d.trim()).filter(Boolean),
    };

    if (!cleaned.question || !cleaned.correctAnswer) {
      toast({ title: "Missing text", description: "A question and a correct answer are required.", variant: "destructive" });
      return;
    }
    if (cleaned.distractors.length === 0) {
      toast({ title: "Add a distractor", description: "Each question needs at least one wrong option.", variant: "destructive" });
      return;
    }
    const allOptions = [cleaned.correctAnswer, ...cleaned.distractors].map((o) => o.toLowerCase());
    if (new Set(allOptions).size !== allOptions.length) {
      toast({ title: "Duplicate options", description: "Every answer option must be different.", variant: "destructive" });
      return;
    }

    const updated = questions.map((q) => (q.id === cleaned.id ? cleaned : q));
    // The selected answer text may no longer exist; clear it for this question.
    setSelectedAnswers((prev) => {
      const next = { ...prev };
      delete next[cleaned.id];
      return next;
    });
    cancelEditing();
    await commit(updated, "Question Updated", "Your edits have been saved.");
  };

  const removeImage = async (id: string) => {
    const updated = questions.map((q) => (q.id === id ? { ...q, imageUrl: undefined } : q));
    if (draft?.id === id) setDraft({ ...draft, imageUrl: undefined });
    await commit(updated, "Image Removed", "The diagram has been removed.");
  };

  const shuffleQuestions = async () => {
    await commit(shuffle(questions), "Order Randomized", "Questions have been re-ordered.");
  };

  const deleteQuestion = async (id: string) => {
    const q = questions.find((x) => x.id === id);
    if (!q || !confirm(`Delete question "${q.question.slice(0, 80)}${q.question.length > 80 ? "…" : ""}"?`)) return;
    if (editingId === id) cancelEditing();
    await commit(
      questions.filter((x) => x.id !== id),
      "Question Deleted",
      "The question has been removed from the test."
    );
  };

  const handleSelectAnswer = (questionId: string, answer: string) => {
    if (selectedAnswers[questionId] !== undefined) return;
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const resetTestAttempt = () => {
    setSelectedAnswers({});
    setShowGrade(false);
    setAttempt((a) => a + 1);
    toast({ title: "Answers Cleared", description: "Options have been re-shuffled for a fresh attempt." });
  };

  const finalizeAndGrade = () => {
    setShowGrade(true);
    toast({
      title: "Test Graded",
      description: `You scored ${score.correct}/${score.total} (${score.percentage}%)`,
    });
    requestAnimationFrame(() => {
      document.getElementById("test-results")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const downloadAsTxt = () => {
    const title = testName?.trim() || "TestMaker Exam";
    const body = questions
      .map((q, i) => {
        const options = optionsById[q.id] ?? [];
        const correctLetter = letter(options.indexOf(q.correctAnswer));
        return [
          `Q${i + 1}: ${q.question}`,
          ...options.map((opt, idx) => `   ${letter(idx)}) ${opt}`),
          `Answer: ${correctLetter}) ${q.correctAnswer}`,
        ].join("\n");
      })
      .join("\n\n");

    const blob = new Blob([`${title}\n${"=".repeat(title.length)}\n\n${body}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(title)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** Opens a print-ready version of the exam; the browser's print dialog can save it as PDF. */
  const exportAsPdf = () => {
    const title = escapeHtml(testName?.trim() || "TestMaker Exam");
    const questionHtml = questions
      .map((q, i) => {
        const options = optionsById[q.id] ?? [];
        return `<section class="q">
          <p class="stem"><strong>${i + 1}.</strong> ${escapeHtml(q.question)}</p>
          <ol type="A">${options.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ol>
        </section>`;
      })
      .join("");
    const keyHtml = questions
      .map((q, i) => {
        const options = optionsById[q.id] ?? [];
        return `<li>${i + 1}. <strong>${letter(options.indexOf(q.correctAnswer))}</strong> — ${escapeHtml(q.correctAnswer)}</li>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        body { font-family: Inter, system-ui, sans-serif; color: #0f172a; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.5; }
        h1 { font-size: 24px; margin-bottom: 4px; }
        .meta { color: #64748b; font-size: 13px; margin-bottom: 32px; }
        .q { break-inside: avoid; margin-bottom: 20px; }
        .stem { margin: 0 0 6px; }
        ol { margin: 0; padding-left: 28px; }
        li { margin: 2px 0; }
        .key { break-before: page; }
        .key ul { list-style: none; padding: 0; columns: 2; }
      </style></head><body>
      <h1>${title}</h1>
      <p class="meta">${questions.length} questions · Name: ______________________ · Date: __________</p>
      ${questionHtml}
      <div class="key"><h2>Answer Key</h2><ul>${keyHtml}</ul></div>
      <script>window.onload = () => { window.print(); };</script>
      </body></html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to export the PDF.", variant: "destructive" });
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <button type="button" onClick={onReset} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="h-3 w-3" /> Back to start
          </button>
          <h2 className="text-2xl font-bold font-headline text-primary">{testName?.trim() || "Test Review"}</h2>
          <p className="text-sm text-muted-foreground">
            {questions.length} question{questions.length === 1 ? "" : "s"} ·{" "}
            {testId ? "Changes are saved to your library automatically." : "Not saved to your library."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetTestAttempt} className="rounded-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset Answers
          </Button>
          <Button variant="outline" size="sm" onClick={shuffleQuestions} disabled={questions.length < 2} className="rounded-full text-indigo-600 border-indigo-200 hover:bg-indigo-50">
            <Shuffle className="h-4 w-4 mr-2" />
            Shuffle Order
          </Button>
          <Button variant="default" size="sm" onClick={finalizeAndGrade} disabled={questions.length === 0} className="bg-primary hover:bg-primary/90 text-white rounded-full shadow-md">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Finalize & Grade
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {questions.length === 0 && (
          <div className="py-20 text-center text-muted-foreground bg-white rounded-xl border-2 border-dashed">
            No questions found. Please try generating again.
          </div>
        )}
        {questions.map((q, idx) => {
          const isEditing = editingId === q.id && draft !== null;
          const model = getModelOption(q.sourceModel);
          const selected = selectedAnswers[q.id];
          const hasSelected = selected !== undefined;

          return (
            <Card key={q.id} className="overflow-hidden border-none shadow-md bg-white hover:shadow-lg transition-shadow rounded-2xl">
              <CardHeader className="border-b bg-slate-50/50 p-4 sm:p-8">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="space-y-4 flex-1 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-white font-mono text-[10px] px-2 py-0.5 shrink-0">
                        QUESTION {idx + 1}
                      </Badge>
                      {q.imageUrl && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] shrink-0">DIAGRAM INCLUDED</Badge>}
                      {q.sourceModel && (
                        <Badge className={`text-[10px] shrink-0 ${model?.badgeClass ?? "bg-slate-50 text-slate-600 border-slate-100"}`}>
                          {model?.label ?? q.sourceModel}
                        </Badge>
                      )}
                    </div>
                    {isEditing ? (
                      <Textarea
                        aria-label="Question text"
                        value={draft.question}
                        onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                        className="text-base sm:text-lg font-bold bg-white leading-relaxed min-h-[100px]"
                      />
                    ) : (
                      <h3 className="text-lg sm:text-xl font-bold text-slate-800 leading-relaxed">{q.question}</h3>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 self-end sm:self-start">
                    {isEditing ? (
                      <>
                        <Button variant="ghost" size="icon" onClick={saveEditing} aria-label="Save changes" className="text-emerald-600 hover:bg-emerald-50">
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={cancelEditing} aria-label="Cancel editing" className="text-slate-400 hover:bg-slate-100">
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => startEditing(q)} aria-label="Edit question" className="text-slate-400 hover:text-primary hover:bg-primary/5">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteQuestion(q.id)} aria-label="Delete question" className="text-slate-400 hover:text-rose-500 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {q.imageUrl && (
                  <div className="mt-6 rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white p-2 relative group">
                    <div className="relative aspect-video w-full">
                      {/* Images can come from arbitrary hosts, so next/image's allow-list doesn't fit here. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={q.imageUrl}
                        alt={`Diagram for question ${idx + 1}`}
                        className="object-contain w-full h-full rounded-xl transition-transform duration-500 group-hover:scale-[1.01]"
                      />
                    </div>
                    {isEditing && (
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label="Remove image"
                        className="absolute top-4 right-4 h-8 w-8 rounded-full shadow-lg transition-opacity"
                        onClick={() => removeImage(q.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-6">
                  {isEditing ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Correct Answer</p>
                        <Input
                          aria-label="Correct answer"
                          value={draft.correctAnswer}
                          onChange={(e) => setDraft({ ...draft, correctAnswer: e.target.value })}
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Distractors</p>
                        <div className="space-y-2">
                          {draft.distractors.map((dist, dIdx) => (
                            <div key={dIdx} className="flex items-center gap-1">
                              <Input
                                aria-label={`Distractor ${dIdx + 1}`}
                                value={dist}
                                onChange={(e) => {
                                  const distractors = [...draft.distractors];
                                  distractors[dIdx] = e.target.value;
                                  setDraft({ ...draft, distractors });
                                }}
                                className="bg-white text-xs"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove distractor ${dIdx + 1}`}
                                className="h-8 w-8 shrink-0 text-slate-400 hover:text-rose-500"
                                onClick={() => setDraft({ ...draft, distractors: draft.distractors.filter((_, i) => i !== dIdx) })}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          {draft.distractors.length < 5 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-primary"
                              onClick={() => setDraft({ ...draft, distractors: [...draft.distractors, ""] })}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Add distractor
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {optionsById[q.id]?.map((option, oIdx) => {
                        const isSelected = selected === option;
                        const isCorrect = option === q.correctAnswer;

                        let className =
                          "justify-start text-left h-auto py-3 sm:py-4 px-4 sm:px-6 rounded-xl transition-all duration-300 whitespace-normal disabled:opacity-100 ";
                        if (hasSelected) {
                          if (isCorrect) {
                            className += "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm ring-1 ring-emerald-500";
                          } else if (isSelected) {
                            className += "bg-rose-50 border-rose-500 text-rose-700 shadow-sm ring-1 ring-rose-500";
                          } else {
                            className += "!opacity-50 grayscale-[0.5]";
                          }
                        } else {
                          className += "hover:bg-primary/5 hover:border-primary/50 hover:shadow-sm";
                        }

                        return (
                          <Button
                            key={`${oIdx}-${option}`}
                            variant="outline"
                            className={className}
                            onClick={() => handleSelectAnswer(q.id, option)}
                            disabled={hasSelected}
                          >
                            <div className="flex items-center gap-4 w-full">
                              <div
                                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold shrink-0 transition-colors ${
                                  hasSelected && isCorrect
                                    ? "bg-emerald-500 border-emerald-500 text-white"
                                    : hasSelected && isSelected
                                      ? "bg-rose-500 border-rose-500 text-white"
                                      : "border-slate-200 text-slate-400"
                                }`}
                              >
                                {letter(oIdx)}
                              </div>
                              <span className="flex-1">{option}</span>
                              {hasSelected && isCorrect && <Check className="h-5 w-5 text-emerald-600 shrink-0" />}
                              {hasSelected && isSelected && !isCorrect && <X className="h-5 w-5 text-rose-600 shrink-0" />}
                            </div>
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  {hasSelected && !isEditing && (
                    <div
                      className={`p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-2 duration-300 ${
                        selected === q.correctAnswer
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
                          : "bg-rose-50 text-rose-800 border border-rose-100"
                      }`}
                    >
                      {selected === q.correctAnswer ? (
                        <>
                          <Check className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                          <p className="text-sm">
                            <span className="font-bold">Correct!</span> You identified the right answer.
                          </p>
                        </>
                      ) : (
                        <>
                          <X className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
                          <p className="text-sm">
                            <span className="font-bold">Incorrect.</span> The correct answer was{" "}
                            <span className="font-bold underline italic">{q.correctAnswer}</span>.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showGrade && (
        <div id="test-results" className="bg-white rounded-2xl shadow-2xl p-8 border-2 border-primary animate-in zoom-in-95 duration-500">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 128 128" aria-hidden="true">
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
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-slate-800">{score.percentage}%</span>
              </div>
            </div>

            <div className="flex-1 space-y-2 text-center md:text-left">
              <h3 className="text-3xl font-black text-slate-800 font-headline">Test Results</h3>
              <p className="text-lg text-slate-500">
                You correctly answered <span className="font-bold text-primary">{score.correct}</span> out of{" "}
                <span className="font-bold text-slate-700">{score.total}</span> questions.
              </p>
              <div className="flex flex-wrap gap-2 pt-2 justify-center md:justify-start">
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">{score.correct} Correct</Badge>
                <Badge className="bg-rose-100 text-rose-700 border-rose-200">{score.incorrect} Incorrect</Badge>
                {score.unanswered > 0 && (
                  <Badge className="bg-slate-100 text-slate-600 border-slate-200">{score.unanswered} Unanswered</Badge>
                )}
              </div>
            </div>

            <Button onClick={resetTestAttempt} variant="outline" className="rounded-full border-slate-200 h-12 px-6">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </div>
      )}

      <div className="bg-primary/5 rounded-2xl p-6 sm:p-8 border border-primary/10 flex flex-col lg:flex-row items-center justify-between gap-6">
        <div className="space-y-1 text-center lg:text-left">
          <h3 className="text-xl font-bold text-primary font-headline">Ready for the Exam?</h3>
          <p className="text-sm text-muted-foreground">Download your test and share it with your students or colleagues.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
          <Button
            variant="outline"
            onClick={downloadAsTxt}
            disabled={questions.length === 0}
            className="w-full sm:w-auto rounded-full border-primary text-primary hover:bg-primary/5"
          >
            <Download className="h-4 w-4 mr-2" />
            Download .txt
          </Button>
          <Button
            onClick={exportAsPdf}
            disabled={questions.length === 0}
            className="w-full sm:w-auto rounded-full bg-primary hover:bg-primary/90 text-white px-8 h-12 text-lg shadow-lg"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export as PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
