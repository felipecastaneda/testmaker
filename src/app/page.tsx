"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/TestMaker/Navbar";
import { FileUploader, type GenerateRequest } from "@/components/TestMaker/FileUploader";
import { TestPreview } from "@/components/TestMaker/TestPreview";
import { TestLibrary } from "@/components/TestMaker/TestLibrary";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAccessGate } from "@/components/auth/AccessGate";
import { generateQuestionBatch } from "@/app/actions/generate";
import { updatePrefs } from "@/app/actions/settings";
import { loadTest, saveTest } from "@/app/actions/tests";
import { Loader2, Sparkles, Rocket, CheckCircle2, Plus, Library, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { toast } from "@/hooks/use-toast";
import { AVAILABLE_MODELS } from "@/ai/models";
import { chunkDocument, dedupeQuestions, planBatches } from "@/lib/generation";
import { mapWithConcurrency } from "@/lib/utils";
import type { QuestionData, SaveMode, SaveTestOutcome, StoredTest } from "@/lib/types";
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

/** Simultaneous generation requests in flight, to stay under provider rate limits. */
const GENERATION_CONCURRENCY = 4;

class StopGeneration extends Error {}

function describeSave(outcome: SaveTestOutcome): string {
  switch (outcome.mode) {
    case "created":
      return `"${outcome.name}" was saved to your library.`;
    case "version_bumped":
      return `Saved as version ${outcome.version} of "${outcome.name}". The previous version was archived.`;
    case "appended":
      return `Questions were appended to "${outcome.name}".`;
    case "recreated":
      return `"${outcome.name}" was re-created from scratch.`;
  }
}

export default function Home() {
  const auth = useAuth();
  const { callAction } = auth;
  const [step, setStep] = useState<AppStep>("input");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [generatedQuestions, setGeneratedQuestions] = useState<QuestionData[]>([]);
  const [testName, setTestName] = useState<string>("");
  const [testId, setTestId] = useState<string | null>(null);
  const [testVersion, setTestVersion] = useState<number | undefined>(undefined);
  const [testCourseId, setTestCourseId] = useState<string | null>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const [selectedModels, setSelectedModels] = useState<string[]>(AVAILABLE_MODELS.map((m) => m.id));
  const savedModels = auth.access.status === "allowed" ? auth.access.account.selectedModels : null;

  // Start from the user's saved model choice once their account loads.
  useEffect(() => {
    const valid = savedModels?.filter((id) => AVAILABLE_MODELS.some((m) => m.id === id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (valid?.length) setSelectedModels(valid);
  }, [savedModels]);

  const changeModels = (models: string[]) => {
    setSelectedModels(models);
    void callAction((token) => updatePrefs(token, { selectedModels: models }));
  };
  const [activeTab, setActiveTab] = useState<"new" | "library">("new");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ name: string; questions: QuestionData[]; mode: SaveMode; courseId?: string } | null>(null);
  const cancelRef = useRef(false);

  const heroImage = PlaceHolderImages.find((img) => img.id === "hero-illustration");

  const showReview = (questions: QuestionData[], name: string, id: string | null, version?: number, courseId?: string) => {
    setGeneratedQuestions(questions);
    setTestName(name);
    setTestId(id);
    setTestVersion(version);
    setTestCourseId(courseId ?? null);
    setReviewKey((k) => k + 1);
    setStep("review");
  };

  const reloadTest = async (id: string) => {
    const result = await callAction((token) => loadTest(token, id));
    if (result.success && result.data) {
      showReview(result.data.questions, result.data.name, result.data.id, result.data.version, result.data.courseId);
    } else {
      toast({ title: "Couldn't reload the test", description: result.error, variant: "destructive" });
    }
  };

  const persist = async (name: string, questions: QuestionData[], mode: SaveMode, courseId?: string) => {
    const result = await callAction((token) => saveTest(token, name, questions, mode, courseId));
    if (!result.success || !result.data) {
      toast({
        title: "Couldn't save test",
        description: result.error ?? "Your questions are still shown here, but weren't saved.",
        variant: "destructive",
      });
      return;
    }
    const outcome = result.data;
    toast({ title: "Test saved", description: describeSave(outcome) });

    if (mode === "append") {
      // Show the merged test so the review matches what's stored.
      await reloadTest(outcome.id);
      return;
    }
    setTestId(outcome.id);
    setTestName(outcome.name);
    setTestVersion(outcome.version);
    setTestCourseId(outcome.courseId);
  };

  const handleGenerate = async (request: GenerateRequest) => {
    const { testName: name, saveMode, questionCount, courseId, models } = request;
    cancelRef.current = false;
    setTestName(name);
    setTestId(null);
    setStep("processing");
    setLoadingProgress(3);
    setLoadingStatus("Planning your test...");

    const chunks = chunkDocument(request.content);
    const batches = planBatches(chunks, models, questionCount);
    let produced = 0;
    let requested = 0;
    const errors = new Set<string>();

    setLoadingStatus(
      chunks.length > 1
        ? `Writing questions from ${chunks.length} sections of your document...`
        : "AI models are writing your questions..."
    );

    const settled = await mapWithConcurrency(batches, GENERATION_CONCURRENCY, async (batch) => {
      if (cancelRef.current) throw new StopGeneration();
      const result = await callAction((token) =>
        generateQuestionBatch(token, {
          chunk: chunks[batch.chunkIndex],
          count: batch.count,
          model: batch.model,
          difficulty: request.difficulty,
          questionTypes: request.questionTypes,
          instructions: request.recommendations,
          courseId,
        })
      );
      requested += batch.count;
      setLoadingProgress(3 + Math.floor((requested / questionCount) * 92));
      if (!result.success) {
        // Quota and auth problems affect every remaining batch, so stop early.
        if (result.code || result.error?.startsWith("Daily limit")) cancelRef.current = true;
        throw new Error(result.error ?? "Generation failed.");
      }
      produced += result.data?.length ?? 0;
      setLoadingStatus(`${produced} of ${questionCount} questions written...`);
      return result.data ?? [];
    });

    void auth.refreshAccount();

    const raw: QuestionData[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") raw.push(...outcome.value);
      else if (!(outcome.reason instanceof StopGeneration)) errors.add(String((outcome.reason as Error)?.message ?? outcome.reason));
    }
    const questions = dedupeQuestions(raw).slice(0, questionCount);

    if (cancelRef.current && errors.size === 0) {
      toast({ title: "Generation cancelled", description: questions.length ? `Kept ${questions.length} questions.` : undefined });
    }
    if (errors.size > 0) {
      toast({
        title: questions.length ? "Some requests failed" : "Couldn't generate a test",
        description: Array.from(errors).join(" "),
        variant: "destructive",
      });
    }

    if (questions.length === 0) {
      setStep("input");
      setLoadingProgress(0);
      return;
    }

    const removed = raw.length - questions.length;
    if (questions.length < questionCount && !cancelRef.current) {
      toast({
        title: "Fewer questions than requested",
        description: `Generated ${questions.length} of ${questionCount}${removed > 0 ? ` (${removed} near-duplicates removed)` : ""}.`,
      });
    }

    setLoadingProgress(100);
    showReview(questions, name, null);

    if (saveMode === "append" || saveMode === "recreate") {
      setPendingSave({ name, questions, mode: saveMode, courseId });
      setShowConfirmDialog(true);
    } else {
      await persist(name, questions, saveMode, courseId);
    }
  };

  const handleLoadExisting = (test: StoredTest) => {
    showReview(test.questions, test.name, test.id, test.version, test.courseId);
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    setIsSaving(true);
    await persist(pendingSave.name, pendingSave.questions, pendingSave.mode, pendingSave.courseId);
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
    setTestVersion(undefined);
    setLoadingProgress(0);
    setLoadingStatus("");
    setActiveTab("new");
  };

  const { ready, gate } = useAccessGate();

  const currentStep: AppStep = ready ? step : "input";

  return (
    <div className="flex flex-col min-h-screen selection:bg-accent/30">
      <Navbar selectedModels={selectedModels} onModelsChange={changeModels} onHome={reset} />

      <main className="flex-1">
        {currentStep === "input" && (
          <div className="relative overflow-hidden bg-primary pt-12 pb-32 lg:pt-20 lg:pb-40">
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
                      TestMaker reads your documents and crafts multiple-choice and true/false questions with plausible distractors, explanations and source quotes.
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center lg:justify-start gap-6 pt-4">
                    {["Instant Analysis", "Smart Distractors", "Export Ready"].map((label) => (
                      <div key={label} className="flex items-center gap-2 text-white/90">
                        <CheckCircle2 className="h-5 w-5 text-accent" />
                        <span className="text-sm font-medium">{label}</span>
                      </div>
                    ))}
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

        <div className={`container mx-auto px-4 ${currentStep === "input" ? "-mt-20 lg:-mt-24" : "py-12"}`}>
          <div className="max-w-5xl mx-auto">
            {currentStep === "input" && (
              <div className="space-y-6">
                {ready && (
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
                )}

                <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-slate-100 relative z-20">
                  {gate ??
                    (activeTab === "new" ? (
                      <FileUploader onContentReady={handleGenerate} selectedModels={selectedModels} />
                    ) : (
                      <TestLibrary onSelectTest={handleLoadExisting} />
                    ))}
                </div>
              </div>
            )}

            {currentStep === "processing" && (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => {
                      cancelRef.current = true;
                      setLoadingStatus("Cancelling after the current requests finish...");
                    }}
                  >
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            )}

            {currentStep === "review" && (
              <TestPreview
                key={reviewKey}
                questions={generatedQuestions}
                setQuestions={setGeneratedQuestions}
                onReset={reset}
                testId={testId}
                testName={testName}
                version={testVersion}
                courseId={testCourseId}
                onReload={() => testId && reloadTest(testId)}
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
            <p className="text-slate-400 text-sm">© {new Date().getFullYear()} TestMaker AI. Designed for intelligent assessment.</p>
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
