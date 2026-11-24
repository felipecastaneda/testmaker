"use client";

import React, { useState } from "react";
import { Check, Edit2, Loader2, Plus, Quote, Tag, Trash2, X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getModelOption } from "@/ai/models";
import { formatPoints, isTrueFalse, MAX_POINTS, normalizeTags, optionLetter, pointsOf } from "@/lib/question-utils";
import type { QuestionData } from "@/lib/types";

export type ViewMode = "author" | "student";

interface QuestionCardProps {
  question: QuestionData;
  index: number;
  mode: ViewMode;
  options: string[];
  /** Student mode: the option the student picked. */
  selected?: string;
  /** Student mode: answers have been submitted and graded. */
  submitted: boolean;
  onSelect: (option: string) => void;
  /** Returns an error message, or null on success. */
  onSave: (updated: QuestionData) => Promise<string | null>;
  onDelete: () => void;
}

const DIFFICULTY_BADGE: Record<string, string> = {
  easy: "bg-emerald-50 text-emerald-700 border-emerald-100",
  medium: "bg-amber-50 text-amber-700 border-amber-100",
  hard: "bg-rose-50 text-rose-700 border-rose-100",
};

function validate(draft: QuestionData): string | null {
  if (!draft.question.trim() || !draft.correctAnswer.trim()) return "A question and a correct answer are required.";
  const points = pointsOf(draft);
  if (draft.points !== undefined && (!Number.isFinite(draft.points) || draft.points < 0 || draft.points > MAX_POINTS)) {
    return `Points must be between 0 and ${MAX_POINTS}.`;
  }
  if (Math.round(points * 2) !== points * 2) return "Points must be whole or half numbers (e.g. 1 or 1.5).";
  if (isTrueFalse(draft)) return null;
  const distractors = draft.distractors.map((d) => d.trim()).filter(Boolean);
  if (distractors.length === 0) return "Each question needs at least one wrong option.";
  const all = [draft.correctAnswer, ...distractors].map((o) => o.trim().toLowerCase());
  if (new Set(all).size !== all.length) return "Every answer option must be different.";
  return null;
}

export function QuestionCard({ question: q, index, mode, options, selected, submitted, onSelect, onSave, onDelete }: QuestionCardProps) {
  const [draft, setDraft] = useState<QuestionData | null>(null);
  // Tags are typed as comma-separated text and cleaned on save.
  const [tagsText, setTagsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEditing = draft !== null && mode === "author";
  const model = getModelOption(q.sourceModel);
  const tf = isTrueFalse(q);

  const startEditing = () => {
    setDraft({ ...q, distractors: [...q.distractors], points: pointsOf(q) });
    setTagsText((q.tags ?? []).join(", "));
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    const cleaned: QuestionData = {
      ...draft,
      question: draft.question.trim(),
      correctAnswer: draft.correctAnswer.trim(),
      distractors: tf
        ? [draft.correctAnswer === "True" ? "False" : "True"]
        : draft.distractors.map((d) => d.trim()).filter(Boolean),
      explanation: draft.explanation?.trim() || undefined,
      tags: normalizeTags(tagsText),
    };
    if (!cleaned.tags?.length) delete cleaned.tags;
    const problem = validate(cleaned);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const saveError = await onSave(cleaned);
    setSaving(false);
    if (saveError) setError(saveError);
    else setDraft(null);
  };

  const showAnswer = mode === "author" || submitted;

  return (
    <Card className="overflow-hidden border-none shadow-md bg-white hover:shadow-lg transition-shadow rounded-2xl" data-testid="question-card">
      <CardHeader className="border-b bg-slate-50/50 p-4 sm:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="space-y-4 flex-1 w-full">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-white font-mono text-[10px] px-2 py-0.5 shrink-0">
                QUESTION {index + 1}
              </Badge>
              <Badge variant="outline" className="bg-white text-[10px] px-2 py-0.5 shrink-0" data-testid="question-points">
                {formatPoints(pointsOf(q))}
              </Badge>
              {mode === "author" && (
                <>
                  {tf && <Badge variant="outline" className="text-[10px] bg-white">TRUE / FALSE</Badge>}
                  {q.difficulty && (
                    <Badge className={`text-[10px] uppercase ${DIFFICULTY_BADGE[q.difficulty] ?? ""}`}>{q.difficulty}</Badge>
                  )}
                  {q.sourceModel && (
                    <Badge className={`text-[10px] shrink-0 ${model?.badgeClass ?? "bg-slate-50 text-slate-600 border-slate-100"}`}>
                      {model?.label ?? q.sourceModel}
                    </Badge>
                  )}
                  {!isEditing &&
                    q.tags?.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] font-normal gap-1" data-testid="question-tag">
                        <Tag className="h-2.5 w-2.5" />
                        {tag}
                      </Badge>
                    ))}
                </>
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
              <h3 className="text-lg sm:text-xl font-bold text-slate-800 leading-relaxed whitespace-pre-line">{q.question}</h3>
            )}
          </div>
          {mode === "author" && (
            <div className="flex gap-1 shrink-0 self-end sm:self-start">
              {isEditing ? (
                <>
                  <Button variant="ghost" size="icon" onClick={save} disabled={saving} aria-label="Save changes" className="text-emerald-600 hover:bg-emerald-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDraft(null)} disabled={saving} aria-label="Cancel editing" className="text-slate-400 hover:bg-slate-100">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="icon" onClick={startEditing} aria-label="Edit question" className="text-slate-400 hover:text-primary hover:bg-primary/5">
                  <Edit2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete question" className="text-slate-400 hover:text-rose-500 hover:bg-rose-50">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {q.imageUrl && (
          <div className="mt-6 rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white p-2 relative">
            <div className="relative aspect-video w-full">
              {/* Legacy images come from arbitrary hosts, so next/image's allow-list doesn't fit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.imageUrl} alt={`Diagram for question ${index + 1}`} className="object-contain w-full h-full rounded-xl" />
            </div>
            {isEditing && draft.imageUrl && (
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-4 right-4 rounded-full shadow-lg"
                onClick={() => setDraft({ ...draft, imageUrl: undefined })}
              >
                <X className="h-4 w-4 mr-1" /> Remove image on save
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {isEditing ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Correct Answer</p>
                {tf ? (
                  <div className="flex gap-2" role="radiogroup" aria-label="Correct answer">
                    {["True", "False"].map((v) => (
                      <Button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={draft.correctAnswer === v}
                        variant={draft.correctAnswer === v ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDraft({ ...draft, correctAnswer: v })}
                      >
                        {v}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Input aria-label="Correct answer" value={draft.correctAnswer} onChange={(e) => setDraft({ ...draft, correctAnswer: e.target.value })} className="bg-white" />
                )}
              </div>
              {!tf && (
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
                      <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => setDraft({ ...draft, distractors: [...draft.distractors, ""] })}>
                        <Plus className="h-3 w-3 mr-1" /> Add distractor
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
              <div className="space-y-2">
                <label htmlFor={`points-${q.id}`} className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Points
                </label>
                <Input
                  id={`points-${q.id}`}
                  type="number"
                  min={0}
                  max={MAX_POINTS}
                  step={0.5}
                  value={Number.isFinite(draft.points) ? draft.points : ""}
                  onChange={(e) => setDraft({ ...draft, points: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`tags-${q.id}`} className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Tags
                </label>
                <Input
                  id={`tags-${q.id}`}
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="e.g. photosynthesis, cell structure"
                  className="bg-white"
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Explanation</p>
              <Textarea
                aria-label="Explanation"
                value={draft.explanation ?? ""}
                onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
                placeholder="Why is the correct answer right?"
                className="bg-white text-sm min-h-[60px]"
              />
            </div>
            {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="grid gap-3" role={mode === "student" ? "radiogroup" : undefined} aria-label={`Answers for question ${index + 1}`}>
            {options.map((option, oIdx) => {
              const isSelected = selected === option;
              const isCorrect = option === q.correctAnswer;

              let state: "neutral" | "selected" | "correct" | "wrong" | "dim" = "neutral";
              if (mode === "author") state = isCorrect ? "correct" : "neutral";
              else if (submitted) state = isCorrect ? "correct" : isSelected ? "wrong" : "dim";
              else if (isSelected) state = "selected";

              const styles = {
                neutral: "border-slate-200",
                selected: "bg-primary/5 border-primary ring-1 ring-primary",
                correct: "bg-emerald-50 border-emerald-500 text-emerald-700 ring-1 ring-emerald-500",
                wrong: "bg-rose-50 border-rose-500 text-rose-700 ring-1 ring-rose-500",
                dim: "opacity-50",
              }[state];
              const bubble = {
                neutral: "border-slate-200 text-slate-400",
                selected: "bg-primary border-primary text-white",
                correct: "bg-emerald-500 border-emerald-500 text-white",
                wrong: "bg-rose-500 border-rose-500 text-white",
                dim: "border-slate-200 text-slate-400",
              }[state];
              const interactive = mode === "student" && !submitted;

              return (
                <button
                  key={`${oIdx}-${option}`}
                  type="button"
                  role={mode === "student" ? "radio" : undefined}
                  aria-checked={mode === "student" ? isSelected : undefined}
                  disabled={!interactive}
                  onClick={() => onSelect(option)}
                  className={`flex items-center gap-4 w-full text-left rounded-xl border bg-white py-3 sm:py-4 px-4 sm:px-6 text-sm transition-all ${styles} ${interactive ? "hover:bg-primary/5 hover:border-primary/50 cursor-pointer" : "cursor-default"}`}
                >
                  <span className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold shrink-0 ${bubble}`}>
                    {optionLetter(oIdx)}
                  </span>
                  <span className="flex-1">{option}</span>
                  {state === "correct" && <Check className="h-5 w-5 text-emerald-600 shrink-0" aria-label="Correct answer" />}
                  {state === "wrong" && <X className="h-5 w-5 text-rose-600 shrink-0" aria-label="Your answer" />}
                </button>
              );
            })}
          </div>
        )}

        {mode === "student" && submitted && !selected && (
          <p className="text-sm text-slate-500 italic">Not answered.</p>
        )}

        {showAnswer && !isEditing && (q.explanation || q.sourceQuote) && (
          <div className="space-y-3 rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm">
            {q.explanation && (
              <p className="flex gap-2 text-slate-700">
                <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                <span>{q.explanation}</span>
              </p>
            )}
            {q.sourceQuote && (
              <blockquote className="flex gap-2 text-slate-500 italic">
                <Quote className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{q.sourceQuote}</span>
              </blockquote>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
