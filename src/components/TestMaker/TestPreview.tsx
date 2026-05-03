"use client";

import React, { useState } from "react";
import { Download, Edit2, Check, RefreshCw, Trash2, Copy, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export type QuestionData = {
  id: string;
  question: string;
  correctAnswer: string;
  distractors: string[];
};

interface TestPreviewProps {
  questions: QuestionData[];
  onReset: () => void;
}

export function TestPreview({ questions: initialQuestions, onReset }: TestPreviewProps) {
  const [questions, setQuestions] = useState<QuestionData[]>(initialQuestions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [shuffledOptions] = useState<Record<string, string[]>>(() => {
    const options: Record<string, string[]> = {};
    initialQuestions.forEach(q => {
      options[q.id] = [q.correctAnswer, ...q.distractors].sort(() => Math.random() - 0.5);
    });
    return options;
  });
  const { toast } = useToast();

  const handleEdit = (id: string) => {
    setEditingId(id);
  };

  const handleSave = () => {
    setEditingId(null);
    toast({
      title: "Saved",
      description: "Changes have been saved to the test.",
    });
  };

  const updateQuestionText = (id: string, text: string) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, question: text } : q));
  };

  const updateAnswer = (id: string, text: string) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, correctAnswer: text } : q));
  };

  const updateDistractor = (qId: string, index: number, text: string) => {
    setQuestions(questions.map(q => {
      if (q.id === qId) {
        const newDistractors = [...q.distractors];
        newDistractors[index] = text;
        return { ...q, distractors: newDistractors };
      }
      return q;
    }));
  };

  const deleteQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id));
    toast({
      title: "Question Deleted",
      description: "The question has been removed from the test.",
    });
  };

  const handleSelectAnswer = (questionId: string, answer: string) => {
    if (selectedAnswers[questionId]) return; // Only allow one selection
    setSelectedAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const copyToClipboard = () => {
    const text = questions.map((q, i) => {
      const options = [q.correctAnswer, ...q.distractors].sort();
      return `Question ${i + 1}: ${q.question}\nOptions:\n${options.map((opt, idx) => `${String.fromCharCode(65 + idx)}) ${opt}`).join('\n')}\nCorrect Answer: ${q.correctAnswer}\n\n`;
    }).join('');
    
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "The entire test has been copied.",
    });
  };

  const downloadAsTxt = () => {
    const text = questions.map((q, i) => {
      const options = [q.correctAnswer, ...q.distractors].sort();
      return `Q${i + 1}: ${q.question}\n${options.map((opt, idx) => `   ${String.fromCharCode(65 + idx)}) ${opt}`).join('\n')}\nAnswer: ${q.correctAnswer}\n\n`;
    }).join('');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TestMaker_Exam.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-headline text-primary">Test Review</h2>
          <p className="text-sm text-muted-foreground">Review, edit, and export your generated multiple-choice exam.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReset} className="rounded-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Start Over
          </Button>
          <Button variant="outline" size="sm" onClick={copyToClipboard} className="rounded-full">
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          <Button variant="default" size="sm" onClick={downloadAsTxt} className="bg-primary hover:bg-primary/90 text-white rounded-full shadow-md">
            <Download className="h-4 w-4 mr-2" />
            Download TXT
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {questions.length === 0 && (
          <div className="py-20 text-center text-muted-foreground bg-white rounded-xl border-2 border-dashed">
            No questions found. Please try generating again.
          </div>
        )}
        {questions.map((q, idx) => (
          <Card key={q.id} className="overflow-hidden border-none shadow-md bg-white hover:shadow-lg transition-shadow">
            <CardHeader className="bg-slate-50/50 pb-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1 w-full">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-none">
                      Question {idx + 1}
                    </Badge>
                  </div>
                  {editingId === q.id ? (
                    <Input 
                      value={q.question} 
                      onChange={(e) => updateQuestionText(q.id, e.target.value)}
                      className="text-lg font-medium mt-2 bg-white"
                    />
                  ) : (
                    <h3 className="text-lg font-medium pt-1">{q.question}</h3>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-4">
                  {editingId === q.id ? (
                    <Button variant="ghost" size="icon" onClick={handleSave} className="text-accent hover:bg-accent/10">
                      <Check className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(q.id)} className="text-muted-foreground hover:text-primary">
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => deleteQuestion(q.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                {editingId === q.id ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Correct Answer</p>
                      <Input 
                        value={q.correctAnswer} 
                        onChange={(e) => updateAnswer(q.id, e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Distractors</p>
                      <div className="space-y-2">
                        {q.distractors.map((dist, dIdx) => (
                          <Input 
                            key={dIdx}
                            value={dist} 
                            onChange={(e) => updateDistractor(q.id, dIdx, e.target.value)}
                            className="bg-white text-xs"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {shuffledOptions[q.id]?.map((option, oIdx) => {
                      const isSelected = selectedAnswers[q.id] === option;
                      const isCorrect = option === q.correctAnswer;
                      const hasSelected = !!selectedAnswers[q.id];
                      
                      let variant = "outline";
                      let className = "justify-start text-left h-auto py-4 px-6 rounded-xl transition-all duration-300 ";
                      
                      if (hasSelected) {
                        if (isCorrect) {
                          className += "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm ring-1 ring-emerald-500";
                        } else if (isSelected) {
                          className += "bg-rose-50 border-rose-500 text-rose-700 shadow-sm ring-1 ring-rose-500";
                        } else {
                          className += "opacity-50 grayscale-[0.5]";
                        }
                      } else {
                        className += "hover:bg-primary/5 hover:border-primary/50 hover:shadow-sm";
                      }

                      return (
                        <Button
                          key={oIdx}
                          variant="outline"
                          className={className}
                          onClick={() => handleSelectAnswer(q.id, option)}
                          disabled={hasSelected}
                        >
                          <div className="flex items-center gap-4 w-full">
                            <div className={`
                              flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold shrink-0 transition-colors
                              ${hasSelected && isCorrect ? 'bg-emerald-500 border-emerald-500 text-white' : 
                                hasSelected && isSelected && !isCorrect ? 'bg-rose-500 border-rose-500 text-white' : 
                                'border-slate-200 text-slate-400'}
                            `}>
                              {String.fromCharCode(65 + oIdx)}
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
                
                {selectedAnswers[q.id] && (
                  <div className={`
                    p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-2 duration-300
                    ${selectedAnswers[q.id] === q.correctAnswer ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-rose-50 text-rose-800 border border-rose-100'}
                  `}>
                    {selectedAnswers[q.id] === q.correctAnswer ? (
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
                          <span className="font-bold">Incorrect.</span> The correct answer was <span className="font-bold underline italic">{q.correctAnswer}</span>.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-primary/5 rounded-2xl p-8 border border-primary/10 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-primary font-headline">Ready for the Exam?</h3>
          <p className="text-sm text-muted-foreground">Download your test and share it with your students or colleagues.</p>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" className="rounded-full border-primary text-primary hover:bg-primary/5">
            <FileDown className="h-4 w-4 mr-2" />
            Export as PDF
          </Button>
          <Button onClick={downloadAsTxt} className="rounded-full bg-primary hover:bg-primary/90 text-white px-8 h-12 text-lg shadow-lg">
            Finalize & Download
          </Button>
        </div>
      </div>
    </div>
  );
}