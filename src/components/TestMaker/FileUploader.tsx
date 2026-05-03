"use client";

import React, { useState } from "react";
import { Upload, FileText, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { listTests } from "@/app/actions/load-test";
import { useEffect } from "react";

interface FileUploaderProps {
  onContentReady: (content: string, testName: string, saveMode: 'new_version' | 'append', questionCount: number, generateImages: boolean) => void;
}

export function FileUploader({ onContentReady }: FileUploaderProps) {
  const [content, setContent] = useState("");
  const [testName, setTestName] = useState("");
  const [saveMode, setSaveMode] = useState<'new_version' | 'append'>("new_version");
  const [questionCount, setQuestionCount] = useState(5);
  const [generateImages, setGenerateImages] = useState(false);
  const [existingTests, setExistingTests] = useState<{name: string}[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    const fetchExisting = async () => {
      const result = await listTests();
      if (result.success) {
        // Unique names only
        const uniqueNames = Array.from(new Set(result.tests?.map(t => t.name) || [])) as string[];
        setExistingTests(uniqueNames.map(n => ({ name: n })));
      }
    };
    fetchExisting();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === "text/plain") {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setContent(text);
          setFileName(file.name);
        };
        reader.readAsText(file);
      } else {
        // For .docx and .xlsx in a real app, we'd use a server-side parser or specialized library.
        // For this prototype, we guide the user to paste or provide a .txt.
        setFileName(file.name + " (Parsing simulated)");
        // Just providing placeholder text for non-txt files in this prototype
        setContent("Simulated content extracted from " + file.name + ". In a production environment, this would use a library like mammoth.js for DOCX or sheetjs for XLSX.");
      }
    }
  };

  const clearFile = () => {
    setFileName(null);
    setContent("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold font-headline">1. Provide Test Name & Content</h2>
          <p className="text-sm text-muted-foreground">Give your test a title and upload your material</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label htmlFor="test-name" className="text-sm font-medium">
              {saveMode === 'append' ? 'Target Test' : 'Test Name'}
            </label>
            {saveMode === 'append' && existingTests.length > 0 ? (
              <select
                className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all bg-white"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
              >
                <option value="">Select a test to append to...</option>
                {existingTests.map((t, i) => (
                  <option key={i} value={t.name}>{t.name}</option>
                ))}
              </select>
            ) : (
              <input
                id="test-name"
                type="text"
                placeholder={saveMode === 'append' ? "Type exact name of existing test" : "e.g., Biology Midterm 2026"}
                className="w-full p-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
              />
            )}
            {saveMode === 'append' && existingTests.length === 0 && (
              <p className="text-[10px] text-amber-600 mt-1">No existing tests found to append to.</p>
            )}
          </div>
        </div>

        <div className="space-y-3 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-700">Save Strategy</label>
            <div className="flex p-1 bg-white border border-slate-200 rounded-xl gap-1 shadow-sm">
              <button
                onClick={() => setSaveMode("new_version")}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${saveMode === 'new_version' ? 'bg-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}
              >
                New Version (v2, v3...)
              </button>
              <button
                onClick={() => setSaveMode("append")}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${saveMode === 'append' ? 'bg-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Append to Latest
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 italic">
            {saveMode === 'new_version' 
              ? "Creates a separate file for this generation." 
              : "Adds these questions to the existing file of the same name."}
          </p>
        </div>

        <div className="space-y-4 p-5 bg-primary/5 rounded-2xl border border-primary/10">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-sm font-bold text-slate-800">Exam Length</label>
              <p className="text-[11px] text-slate-500">How many questions should we generate?</p>
            </div>
            <div className="flex items-center gap-4">
              <input 
                type="range" 
                min="1" 
                max="50" 
                value={questionCount}
                onChange={(e) => setQuestionCount(parseInt(e.target.value))}
                className="w-32 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="bg-primary text-white font-bold px-3 py-1 rounded-lg text-sm min-w-[3rem] text-center shadow-sm">
                {questionCount}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5 bg-amber-50/50 rounded-2xl border border-amber-100 flex items-center justify-between">
          <div className="space-y-1">
            <label className="text-sm font-bold text-slate-800">Visual Aids</label>
            <p className="text-[11px] text-slate-500">Generate AI illustrations for complex questions?</p>
          </div>
          <button
            onClick={() => setGenerateImages(!generateImages)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${generateImages ? 'bg-primary' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${generateImages ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6 border-dashed border-2 flex flex-col items-center justify-center text-center space-y-4 hover:border-primary/50 transition-colors bg-white">
            <div className="bg-primary/10 p-4 rounded-full">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="font-medium">Upload Document</p>
              <p className="text-xs text-muted-foreground">Supports .txt, .docx, .xlsx</p>
            </div>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              onChange={handleFileChange}
              accept=".txt,.docx,.xlsx"
            />
            <Button asChild variant="outline" size="sm" className="cursor-pointer">
              <label htmlFor="file-upload">Choose File</label>
            </Button>
            {fileName && (
              <div className="flex items-center gap-2 bg-secondary px-3 py-1 rounded-full text-xs animate-in fade-in slide-in-from-top-1">
                <FileText className="h-3 w-3" />
                <span className="truncate max-w-[150px]">{fileName}</span>
                <button onClick={clearFile} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </Card>

          <div className="space-y-2">
            <p className="text-sm font-medium mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Or Paste Content Directly
            </p>
            <Textarea
              placeholder="Paste the text here..."
              className="min-h-[220px] bg-white text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
      </div>

      {content.length < 50 && content.length > 0 && (
        <Alert variant="default" className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Content too short</AlertTitle>
          <AlertDescription className="text-amber-700">
            For better question generation, please provide at least 50 characters of text.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button 
          onClick={() => onContentReady(content, testName || "Untitled Test", saveMode, questionCount, generateImages)} 
          disabled={content.length < 20}
          className="px-8 bg-primary hover:bg-primary/90 text-white font-semibold rounded-full shadow-lg transition-all hover:scale-105"
        >
          Generate Questions
        </Button>
      </div>
    </div>
  );
}