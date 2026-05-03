"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Navbar } from "@/components/TestMaker/Navbar";
import { FileUploader } from "@/components/TestMaker/FileUploader";
import { TestPreview, QuestionData } from "@/components/TestMaker/TestPreview";
import { generateMultipleChoiceQuestions } from "@/ai/flows/generate-multiple-choice-questions";
import { generateDistractors } from "@/ai/flows/generate-distractors";
import { Loader2, Sparkles, BrainCircuit, Rocket, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { saveTest } from "./actions/save-test";

type AppStep = "input" | "processing" | "review";

export default function Home() {
  const [step, setStep] = useState<AppStep>("input");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [generatedQuestions, setGeneratedQuestions] = useState<QuestionData[]>([]);

  const heroImage = PlaceHolderImages.find(img => img.id === "hero-illustration");

  const handleGenerate = async (content: string, testName: string) => {
    try {
      setStep("processing");
      setLoadingProgress(10);
      setLoadingStatus("AI is reading your document...");

      // 1. Generate core questions
      const result = await generateMultipleChoiceQuestions({ documentContent: content });
      setLoadingProgress(40);
      setLoadingStatus("Extracting core knowledge points...");

      if (!result.questions || result.questions.length === 0) {
        throw new Error("No questions could be generated from this content.");
      }

      // 2. Generate distractors for each question
      const fullQuestions: QuestionData[] = [];
      const total = result.questions.length;
      
      for (let i = 0; i < total; i++) {
        const q = result.questions[i];
        setLoadingStatus(`Creating clever distractors for question ${i + 1} of ${total}...`);
        
        const distractors = await generateDistractors({
          question: q.question,
          correctAnswer: q.correctAnswer,
          numberOfDistractors: 3
        });
        
        fullQuestions.push({
          id: Math.random().toString(36).substr(2, 9),
          question: q.question,
          correctAnswer: q.correctAnswer,
          distractors: distractors
        });
        
        // Progress from 40% to 95%
        setLoadingProgress(Math.floor(40 + (i + 1) / total * 55));
      }

      setGeneratedQuestions(fullQuestions);
      
      // 3. Save to JSON file
      setLoadingStatus("Saving your test to the database...");
      const saveResult = await saveTest(testName, fullQuestions);
      
      if (saveResult.success) {
        console.log(`Saved as ${saveResult.fileName} (Version ${saveResult.version})`);
      }

      setLoadingProgress(100);
      setLoadingStatus(saveResult.success 
        ? `Test saved as ${saveResult.fileName}!` 
        : "Test ready for review (Auto-save failed)");
      
      setTimeout(() => {
        setStep("review");
      }, 1000);

    } catch (error) {
      console.error("Generation failed:", error);
      alert("Failed to generate test. Please try with more or different text.");
      setStep("input");
      setLoadingProgress(0);
    }
  };

  const reset = () => {
    setStep("input");
    setGeneratedQuestions([]);
    setLoadingProgress(0);
  };

  return (
    <div className="flex flex-col min-h-screen selection:bg-accent/30">
      <Navbar />

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
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className={`container mx-auto px-4 ${step === 'input' ? '-mt-20 lg:-mt-24' : 'py-12'}`}>
          <div className="max-w-5xl mx-auto">
            {step === "input" && (
              <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-slate-100 relative z-20">
                <FileUploader onContentReady={handleGenerate} />
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
                  <p className="text-muted-foreground">{loadingStatus}</p>
                  <div className="space-y-2">
                    <Progress value={loadingProgress} className="h-2 bg-slate-100" />
                    <p className="text-xs text-right font-medium text-primary">{loadingProgress}% Complete</p>
                  </div>
                </div>
              </div>
            )}

            {step === "review" && (
              <TestPreview questions={generatedQuestions} onReset={reset} />
            )}
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 text-white py-12 mt-20">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-2">
              <div className="bg-primary p-1.5 rounded-lg">
                <Rocket className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold font-headline">TestMaker</span>
            </div>
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
    </div>
  );
}
