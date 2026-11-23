"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/TestMaker/Navbar";
import { FileUploader, type GenerateRequest } from "@/components/TestMaker/FileUploader";
import { TestPreview } from "@/components/TestMaker/TestPreview";
import { generateMultipleChoiceQuestions } from "@/ai/flows/generate-multiple-choice-questions";
import { generateDistractors } from "@/ai/flows/generate-distractors";
import { Loader2, Sparkles, Rocket, CheckCircle2, Plus, Library } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { saveTest, type SaveTestResult } from "./actions/save-test";
import { loadTest } from "./actions/load-test";
import { TestLibrary } from "@/components/TestMaker/TestLibrary";
import { toast } from "@/hooks/use-toast";
import { AVAILABLE_MODELS, getModelOption } from "@/ai/models";
import { createId, mapWithConcurrency } from "@/lib/utils";
import type { QuestionData, SaveMode, StoredTest } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AppStep = "input" | "processing" | "review";

/** Max simultaneous distractor requests per model, to stay under provider rate limits. */
const DISTRACTOR_CONCURRENCY = 4;
const DISTRACTORS_PER_QUESTION = 3;

/** Split `total` across `parts` as evenly as possible, e.g. 5 over 2 -> [3, 2]. */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, i) => base + (i < total % parts ? 1 : 0));
}

function describeSave(result: SaveTestResult, name: string): string {
  switch (result.mode) {
    case "created":
      return `"${name}" was saved to your library.`;
    case "version_bumped":
      return `Saved as version ${result.version} of "${name}". The previous version was archived.`;
    case "appended":
      return `Questions were appended to "${name}".`;
    case "recreated":
      return `"${name}" was re-created from scratch.`;
    default:
      return "Saved.";
  }
}

export default function Home() {
  const [step, setStep] = useState<AppStep>("input");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [generatedQuestions, setGeneratedQuestions] = useState<QuestionData[]>([]);
  const [testName, setTestName] = useState<string>("");
  const [testId, setTestId] = useState<string | null>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const [selectedModels, setSelectedModels] = useState<string[]>(AVAILABLE_MODELS.map((m) => m.id));
  const [activeTab, setActiveTab] = useState<"new" | "library">("new");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ name: string; questions: QuestionData[]; mode: SaveMode } | null>(null);

  const heroImage = PlaceHolderImages.find((img) => img.id === "hero-illustration");

  const showReview = (questions: QuestionData[], name: string, id: string | null) => {
    setGeneratedQuestions(questions);
    setTestName(name);
    setTestId(id);
    setReviewKey((k) => k + 1);
    setStep("review");
  };

  const persist = async (name: string, questions: QuestionData[], mode: SaveMode) => {
    const result = await saveTest(name, questions, mode);
    if (!result.success || !result.id) {
      toast({
        title: "Couldn't save test",
        description: result.error ?? "Your questions are still available for review, but weren't saved.",
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Test saved", description: describeSave(result, name) });
    if (result.warning) {
      toast({ title: "Heads up", description: result.warning });
    }

    if (mode === "append") {
      // Show the merged test so later edits don't overwrite the existing questions.
      const merged = await loadTest(result.id);
      if (merged.success && merged.test) {
        showReview(merged.test.questions, merged.test.name, result.id);
        return;
      }
      // Couldn't load the merged set: keep this view session-only so edits can't clobber it.
      return;
    }
    setTestId(result.id);
  };

  const generateForModel = async (
    model: string,
    count: number,
    request: GenerateRequest,
    onQuestionDone: () => void
  ): Promise<QuestionData[]> => {
    const modelName = getModelOption(model)?.shortName ?? model;
    const result = await generateMultipleChoiceQuestions({
      documentContent: request.content,
      model,
      numberOfQuestions: count,
      specialInstructions: request.recommendations || undefined,
    });

    setLoadingStatus(`${modelName} is writing distractors...`);
    const settled = await mapWithConcurrency(result.questions, DISTRACTOR_CONCURRENCY, async (q) => {
      try {
        return await generateDistractors({
          question: q.question,
          correctAnswer: q.correctAnswer,
          numberOfDistractors: DISTRACTORS_PER_QUESTION,
          model,
        });
      } finally {
        onQuestionDone();
      }
    });

    return result.questions.flatMap((q, i) => {
      const outcome = settled[i];
      // A question without distractors isn't a usable multiple-choice question.
      if (outcome.status !== "fulfilled" || outcome.value.length === 0) return [];
      return [
        {
          id: createId(),
          question: q.question,
          correctAnswer: q.correctAnswer,
          distractors: outcome.value,
          sourceModel: model,
        },
      ];
    });
  };

  const handleGenerate = async (request: GenerateRequest) => {
    const { testName: name, saveMode, questionCount } = request;
    setTestName(name);
    setTestId(null);
    setStep("processing");
    setLoadingProgress(5);
    setLoadingStatus("AI models are reading your document...");

    // Never ask a model for zero questions when there are more models than questions.
    const models = selectedModels.slice(0, questionCount);
    const counts = splitEvenly(questionCount, models.length);
    let completed = 0;
    const onQuestionDone = () => {
      completed++;
      setLoadingProgress(5 + Math.min(90, Math.floor((completed / questionCount) * 90)));
    };

    const results = await Promise.allSettled(
      models.map((model, i) => generateForModel(model, counts[i], request, onQuestionDone))
    );

    const questions: QuestionData[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        questions.push(...r.value);
      } else {
        console.error(`Generation failed for ${models[i]}:`, r.reason);
        if (models.length > 1) {
          toast({
            title: `${getModelOption(models[i])?.label ?? models[i]} failed`,
            description: "Continuing with the other selected model(s).",
            variant: "destructive",
          });
        }
      }
    });

    if (questions.length === 0) {
      toast({
        title: "Couldn't generate a test",
        description: "No questions could be generated. Check your API keys, or try more or different content.",
        variant: "destructive",
      });
      setStep("input");
      setLoadingProgress(0);
      return;
    }

    if (questions.length < questionCount) {
      toast({
        title: "Fewer questions than requested",
        description: `Generated ${questions.length} of ${questionCount} questions.`,
      });
    }

    setLoadingProgress(100);
    showReview(questions, name, null);

    if (saveMode === "append" || saveMode === "recreate") {
      setPendingSave({ name, questions, mode: saveMode });
      setShowConfirmDialog(true);
    } else {
      await persist(name, questions, saveMode);
    }
  };

  const handleLoadExisting = (test: StoredTest) => {
    showReview(test.questions, test.name, test.id);
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    setIsSaving(true);
    await persist(pendingSave.name, pendingSave.questions, pendingSave.mode);
    setIsSaving(false);
    setShowConfirmDialog(false);
    setPendingSave(null);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open || isSaving) return;
    setShowConfirmDialog(false);
    if (pendingSave) {
      toast({
        title: "Not saved",
        description: "The generated questions are shown here but weren't saved to the library.",
      });
      setPendingSave(null);
    }
  };

  const reset = () => {
    setStep("input");
    setGeneratedQuestions([]);
    setTestId(null);
    setLoadingProgress(0);
    setLoadingStatus("");
    setActiveTab("new");
  };

  return (
    <div className="flex flex-col min-h-screen selection:bg-accent/30">
      <Navbar selectedModels={selectedModels} onModelsChange={setSelectedModels} onHome={reset} />

      <main className="flex-1">
        {/* Hero Section */}
        {step === "input" && (
          <div className="relative overflow-hidden bg-primary pt-12 pb-32 lg:pt-20 lg:pb-40">
            {/* Background elements */}
            <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-96 h-96 bg-accent/20 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-64 h-64 bg-white/10 rounded-full blur-2xl" />

            <div className="container mx-auto px-4 relative z-10">
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="text-center lg:text-left space-y-8">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium animate-in slide-in-from-bottom-2 duration-700">
                    <Sparkles className="h-4 w-4 text-accent" />
                    <span>Powered by Advanced AI</span>
                  </div>

                  <div className="space-y-4 max-w-2xl mx-auto lg:mx-0">
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white font-headline leading-[1.1]">
                      Turn Documents into <span className="text-accent">Perfect Exams</span>
                    </h1>
                    <p className="text-lg md:text-xl text-primary-foreground/80">
                      TestMaker reads your documents and instantly crafts high-quality multiple-choice questions with plausible distractors.
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center lg:justify-start gap-6 pt-4">
                    <div className="flex items-center gap-2 text-white/90">
                      <CheckCircle2 className="h-5 w-5 text-accent" />
                      <span className="text-sm font-medium">Instant Analysis</span>
                    </div>
                    <div className="flex items-center gap-2 text-white/90">
                      <CheckCircle2 className="h-5 w-5 text-accent" />
                      <span className="text-sm font-medium">Smart Distractors</span>
                    </div>
                    <div className="flex items-center gap-2 text-white/90">
                      <CheckCircle2 className="h-5 w-5 text-accent" />
                      <span className="text-sm font-medium">Export Ready</span>
                    </div>
                  </div>
                </div>

                <div className="hidden lg:block relative">
                  <div className="absolute inset-0 bg-accent/20 blur-[100px] rounded-full" />
                  {heroImage && (
                    <div className="relative glass-morphism p-4 rounded-2xl border-white/30 rotate-3 hover:rotate-0 transition-transform duration-500">
                      <Image
                        src={heroImage.imageUrl}
                        alt={heroImage.description}
                        width={600}
                        height={400}
                        className="rounded-xl shadow-2xl"
                        data-ai-hint={heroImage.imageHint}
                        priority
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className={`container mx-auto px-4 ${step === "input" ? "-mt-20 lg:-mt-24" : "py-12"}`}>
          <div className="max-w-5xl mx-auto">
            {step === "input" && (
              <div className="space-y-6">
                <div className="flex justify-center w-full">
                  <div className="flex p-1 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-xl relative z-30 w-full max-w-sm sm:w-auto sm:inline-flex">
                    <button
                      type="button"
                      onClick={() => setActiveTab("new")}
                      className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === "new" ? "bg-white text-primary shadow-lg scale-105" : "text-white hover:bg-white/10"}`}
                    >
                      <Plus className="h-4 w-4" /> Create New Test
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("library")}
                      className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === "library" ? "bg-white text-primary shadow-lg scale-105" : "text-white hover:bg-white/10"}`}
                    >
                      <Library className="h-4 w-4" /> My Library
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-slate-100 relative z-20">
                  {activeTab === "new" ? (
                    <FileUploader onContentReady={handleGenerate} />
                  ) : (
                    <TestLibrary onSelectTest={handleLoadExisting} />
                  )}
                </div>
              </div>
            )}

            {step === "processing" && (
              <div className="bg-white rounded-2xl shadow-xl p-12 text-center space-y-10 animate-in zoom-in-95 duration-500 border border-slate-100">
                <div className="relative w-24 h-24 mx-auto">
                  <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-ping" />
                  <div className="relative flex items-center justify-center w-24 h-24 bg-primary/10 rounded-full">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  </div>
                </div>

                <div className="space-y-4 max-w-md mx-auto">
                  <h2 className="text-2xl font-bold font-headline text-slate-800">Generating Your Test</h2>
                  <p className="text-muted-foreground" aria-live="polite">{loadingStatus}</p>
                  <div className="space-y-2">
                    <Progress value={loadingProgress} className="h-2 bg-slate-100" />
                    <p className="text-xs text-right font-medium text-primary">{loadingProgress}% Complete</p>
                  </div>
                </div>
              </div>
            )}

            {step === "review" && (
              <TestPreview
                key={reviewKey}
                questions={generatedQuestions}
                setQuestions={setGeneratedQuestions}
                onReset={reset}
                testId={testId}
                testName={testName}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 text-white py-12 mt-20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <button type="button" onClick={reset} className="flex items-center gap-2 group outline-none">
              <div className="bg-primary p-1.5 rounded-lg group-hover:bg-primary/90 transition-colors">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold font-headline text-white">TestMaker</span>
            </button>
            <p className="text-slate-400 text-sm">
              © {new Date().getFullYear()} TestMaker AI. Designed for intelligent assessment.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-slate-400 hover:text-accent transition-colors">Privacy</a>
              <a href="#" className="text-slate-400 hover:text-accent transition-colors">Terms</a>
              <a href="#" className="text-slate-400 hover:text-accent transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>

      <AlertDialog open={showConfirmDialog} onOpenChange={handleDialogOpenChange}>
        <AlertDialogContent className="bg-white rounded-2xl border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-bold font-headline text-slate-800">
              Confirm {pendingSave?.mode === "append" ? "Appending" : "Re-creating"} Test
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 text-base">
              {pendingSave?.mode === "append"
                ? `You are about to add ${pendingSave?.questions?.length || 0} new questions to "${pendingSave?.name || "this test"}".`
                : `Warning: This will PERMANENTLY WIPE all existing questions and archived versions of "${pendingSave?.name || "this test"}" and replace them with these new ones. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="rounded-full px-6 border-slate-200" disabled={isSaving}>
              Don&apos;t Save
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open (and its buttons disabled) until the save finishes.
                e.preventDefault();
                confirmSave();
              }}
              disabled={isSaving}
              className={`rounded-full px-8 ${pendingSave?.mode === "recreate" ? "bg-rose-500 hover:bg-rose-600" : "bg-primary hover:bg-primary/90"} text-white shadow-lg`}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
