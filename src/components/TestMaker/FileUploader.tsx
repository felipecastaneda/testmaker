"use client";

import React, { useEffect, useState } from "react";
import { Upload, FileText, X, AlertCircle, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { listTests } from "@/app/actions/load-test";
import { extractTextFromFile, SUPPORTED_EXTENSIONS } from "@/lib/document-parser";
import type { SaveMode } from "@/lib/types";

export interface GenerateRequest {
  content: string;
  testName: string;
  saveMode: SaveMode;
  questionCount: number;
  recommendations: string;
}

interface FileUploaderProps {
  onContentReady: (request: GenerateRequest) => void;
}

const MIN_CONTENT_LENGTH = 50;
/** Roughly 50k tokens; beyond this, generation gets slow and expensive. */
const LARGE_CONTENT_WARNING = 200_000;

const SAVE_MODES: { id: SaveMode; label: string; help: string; activeClass: string }[] = [
  {
    id: "new_version",
    label: "New Version",
    help: "Saves under this name. If the test already exists, its current questions are archived and the version number goes up.",
    activeClass: "bg-primary text-white shadow-md",
  },
  {
    id: "append",
    label: "Append",
    help: "Adds these questions to the selected existing test.",
    activeClass: "bg-primary text-white shadow-md",
  },
  {
    id: "recreate",
    label: "Re-create",
    help: "Wipes the selected test (including archived versions) and replaces it with these questions.",
    activeClass: "bg-rose-500 text-white shadow-md",
  },
];

export function FileUploader({ onContentReady }: FileUploaderProps) {
  const [content, setContent] = useState("");
  const [testName, setTestName] = useState("");
  const [saveMode, setSaveMode] = useState<SaveMode>("new_version");
  const [questionCount, setQuestionCount] = useState(5);
  const [recommendations, setRecommendations] = useState("");
  const [existingTestNames, setExistingTestNames] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTests().then((result) => {
      if (cancelled || !result.success) return;
      setExistingTestNames(Array.from(new Set(result.tests?.map((t) => t.name) ?? [])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const targetsExistingTest = saveMode === "append" || saveMode === "recreate";

  const handleModeChange = (mode: SaveMode) => {
    setSaveMode(mode);
    // A free-typed name rarely matches an existing test exactly; make the user pick one.
    if (mode !== "new_version" && !existingTestNames.includes(testName)) {
      setTestName("");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // Reset so selecting the same file again still fires onChange.
    input.value = "";
    if (!file) return;

    setParseError(null);
    setIsParsing(true);
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) {
        throw new Error("No readable text was found in this file.");
      }
      setContent(text);
      setFileName(file.name);
      if (!testName && saveMode === "new_version") {
        setTestName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
      }
    } catch (error) {
      console.error("Failed to read file:", error);
      setParseError(error instanceof Error ? error.message : "Couldn't read this file.");
      setFileName(null);
    } finally {
      setIsParsing(false);
    }
  };

  const clearFile = () => {
    setFileName(null);
    setContent("");
    setParseError(null);
  };

  const trimmedContent = content.trim();
  const missingTarget = targetsExistingTest && !testName;
  const canGenerate = trimmedContent.length >= MIN_CONTENT_LENGTH && !missingTarget && !isParsing;

  const submit = () => {
    if (!canGenerate) return;
    onContentReady({
      content: trimmedContent,
      testName: testName.trim() || "Untitled Test",
      saveMode,
      questionCount,
      recommendations: recommendations.trim(),
    });
  };

  const activeMode = SAVE_MODES.find((m) => m.id === saveMode)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h2 className="text-xl font-semibold font-headline">1. Provide Test Name & Content</h2>
          <p className="text-sm text-muted-foreground">Give your test a title and upload your material</p>
        </div>

        <div className="space-y-3 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-700">Save Strategy</span>
            <div role="radiogroup" aria-label="Save strategy" className="flex p-1 bg-white border border-slate-200 rounded-xl gap-1 shadow-sm w-full sm:w-auto">
              {SAVE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={saveMode === mode.id}
                  onClick={() => handleModeChange(mode.id)}
                  className={`flex-1 sm:flex-none px-2 sm:px-4 py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-all ${saveMode === mode.id ? mode.activeClass : "text-slate-500 hover:text-slate-700"}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500 italic">{activeMode.help}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="test-name" className="text-sm font-medium">
              {targetsExistingTest ? "Target Test" : "Test Name"}
            </label>
            {targetsExistingTest ? (
              <>
                <select
                  id="test-name"
                  className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all bg-white disabled:opacity-60"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  disabled={existingTestNames.length === 0}
                >
                  <option value="">
                    {existingTestNames.length === 0 ? "No saved tests yet" : `Select a test to ${saveMode === "append" ? "append to" : "re-create"}...`}
                  </option>
                  {existingTestNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {existingTestNames.length === 0 && (
                  <p className="text-xs text-amber-600">No existing tests found. Use &quot;New Version&quot; to create one.</p>
                )}
              </>
            ) : (
              <input
                id="test-name"
                type="text"
                placeholder="e.g., Biology Midterm 2026"
                className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                maxLength={120}
              />
            )}
          </div>

          <div className="space-y-2 p-4 bg-primary/5 rounded-2xl border border-primary/10">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <label htmlFor="question-count" className="text-sm font-bold text-slate-800">
                  Exam Length
                </label>
                <p className="text-[11px] text-slate-500">How many questions should we generate?</p>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                <input
                  id="question-count"
                  type="range"
                  min="1"
                  max="100"
                  value={questionCount}
                  onChange={(e) => setQuestionCount(parseInt(e.target.value, 10))}
                  className="w-24 sm:w-32 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="bg-primary text-white font-bold px-2 sm:px-3 py-1 rounded-lg text-xs sm:text-sm min-w-[2.5rem] sm:min-w-[3rem] text-center shadow-sm">
                  {questionCount}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <label htmlFor="recommendations" className="text-sm font-bold text-slate-800">
              AI Recommendations & Personalization
            </label>
          </div>
          <Textarea
            id="recommendations"
            placeholder='e.g., "Use Travelogis as a company example", "Focus on technical implementation", "Make questions challenging"'
            className="bg-white border-indigo-100 text-sm min-h-[80px]"
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6 border-dashed border-2 flex flex-col items-center justify-center text-center space-y-4 hover:border-primary/50 transition-colors bg-white">
            <div className="bg-primary/10 p-4 rounded-full">
              {isParsing ? <Loader2 className="h-8 w-8 text-primary animate-spin" /> : <Upload className="h-8 w-8 text-primary" />}
            </div>
            <div className="space-y-2">
              <p className="font-medium">{isParsing ? "Reading document..." : "Upload Document"}</p>
              <p className="text-xs text-muted-foreground">Supports .txt, .md, .csv, .docx, .xlsx</p>
            </div>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              onChange={handleFileChange}
              accept={SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
              disabled={isParsing}
            />
            <Button asChild variant="outline" size="sm" className="cursor-pointer" disabled={isParsing}>
              <label htmlFor="file-upload">Choose File</label>
            </Button>
            {fileName && (
              <div className="flex items-center gap-2 bg-secondary px-3 py-1 rounded-full text-xs animate-in fade-in slide-in-from-top-1">
                <FileText className="h-3 w-3" />
                <span className="truncate max-w-[150px]" title={fileName}>
                  {fileName}
                </span>
                <button type="button" onClick={clearFile} className="hover:text-destructive" aria-label="Remove file">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </Card>

          <div className="space-y-2">
            <label htmlFor="content" className="text-sm font-medium mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Or Paste Content Directly
            </label>
            <Textarea
              id="content"
              placeholder="Paste the text here..."
              className="min-h-[220px] bg-white text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {content.length > 0 && (
              <p className="text-[11px] text-right text-muted-foreground">{content.length.toLocaleString()} characters</p>
            )}
          </div>
        </div>
      </div>

      {parseError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t read that file</AlertTitle>
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {trimmedContent.length > 0 && trimmedContent.length < MIN_CONTENT_LENGTH && (
        <Alert variant="default" className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Content too short</AlertTitle>
          <AlertDescription className="text-amber-700">
            Please provide at least {MIN_CONTENT_LENGTH} characters of text so the AI has enough material to work with.
          </AlertDescription>
        </Alert>
      )}

      {trimmedContent.length > LARGE_CONTENT_WARNING && (
        <Alert variant="default" className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Large document</AlertTitle>
          <AlertDescription className="text-amber-700">
            This is a lot of text. Generation may be slow or exceed model limits; consider trimming it to the relevant sections.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
        {missingTarget && trimmedContent.length >= MIN_CONTENT_LENGTH && (
          <p className="text-xs text-amber-600">Select a target test above to continue.</p>
        )}
        <Button
          type="button"
          onClick={submit}
          disabled={!canGenerate}
          className="px-8 bg-primary hover:bg-primary/90 text-white font-semibold rounded-full shadow-lg transition-all hover:scale-105"
        >
          Generate Questions
        </Button>
      </div>
    </div>
  );
}
