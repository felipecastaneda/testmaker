"use client";

import React, { useState } from "react";
import { Download, Edit2, Check, X, RefreshCw, Trash2, Copy, FileDown, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { saveTest } from "@/app/actions/save-test";
import { toast } from "@/hooks/use-toast";

export interface QuestionData {
  id: string;
  question: string;
  correctAnswer: string;
  distractors: string[];
  imageUrl?: string;
  sourceModel?: string;
};

interface TestPreviewProps {
  questions: QuestionData[];
  setQuestions: React.Dispatch<React.SetStateAction<QuestionData[]>>;
  onReset: () => void;
  testName?: string;
}

export function TestPreview({ questions, setQuestions, onReset, testName }: TestPreviewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [showGrade, setShowGrade] = useState(false);
  const [shuffledOptions] = useState<Record<string, string[]>>(() => {
    const options: Record<string, string[]> = {};
    questions.forEach(q => {
      options[q.id] = [q.correctAnswer, ...q.distractors].sort(() => Math.random() - 0.5);
    });
    return options;
  });

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
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, question: text } : q));
  };

  const updateAnswer = (id: string, text: string) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, correctAnswer: text } : q));
  };

  const updateDistractor = (qId: string, index: number, text: string) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === qId) {
        const newDistractors = [...q.distractors];
        newDistractors[index] = text;
        return { ...q, distractors: newDistractors };
      }
      return q;
    }));
  };

  const removeImage = async (id: string) => {
    console.log(`Attempting to remove image for question ID: ${id}`);

    setQuestions((prevQuestions: QuestionData[]) => {
      const updatedQuestions = prevQuestions.map(q => q.id === id ? { ...q, imageUrl: undefined } : q);

      // Make deletion permanent in JSON if we have a test name
      if (testName) {
        saveTest(testName, updatedQuestions, 'recreate').then(result => {
          if (result.success) {
            toast({
              title: "Image Deleted Permanently",
              description: "The JSON file has been updated.",
            });
          }
        }).catch(error => {
          console.error("Failed to save image deletion:", error);
          toast({
            title: "Error saving changes",
            description: "The image was removed from view but could not be deleted from the file.",
            variant: "destructive"
          });
        });
      }

      return updatedQuestions;
    });

    if (!testName) {
      toast({
        title: "Image Removed",
        description: "The diagram has been removed from this session.",
      });
    }
  };

  const shuffleQuestions = async () => {
    const shuffled = [...questions].sort(() => Math.random() - 0.5);
    setQuestions(shuffled);
    
    if (testName) {
      try {
        await saveTest(testName, shuffled, 'recreate');
        toast({
          title: "Order Randomized",
          description: "New question order saved to file.",
        });
      } catch (error) {
        console.error("Failed to save shuffle:", error);
      }
    } else {
      toast({
        title: "Order Randomized",
        description: "The current session has been re-shuffled.",
      });
    }
  };

  const deleteQuestion = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
    toast({
      title: "Question Deleted",
      description: "The question has been removed from the test.",
    });
  };

  const handleSelectAnswer = (questionId: string, answer: string) => {
    if (selectedAnswers[questionId]) return; // Only allow one selection
    setSelectedAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const resetTestAttempt = () => {
    setSelectedAnswers({});
    setShowGrade(false);
    toast({
      title: "Test Reset",
      description: "All your answers have been cleared.",
    });
  };

  const calculateScore = () => {
    let correct = 0;
    questions.forEach(q => {
      if (selectedAnswers[q.id] === q.correctAnswer) {
        correct++;
      }
    });
    return {
      score: correct,
      total: questions.length,
      percentage: Math.round((correct / questions.length) * 100)
    };
  };

  const finalizeAndGrade = () => {
    setShowGrade(true);
    const { score, total, percentage } = calculateScore();
    
    toast({
      title: "Test Graded",
      description: `You scored ${score}/${total} (${percentage}%)`,
    });

    // Also trigger download
    downloadAsTxt();
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
          <Button variant="outline" size="sm" onClick={resetTestAttempt} className="rounded-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Start Over
          </Button>
          <Button variant="outline" size="sm" onClick={shuffleQuestions} className="rounded-full text-indigo-600 border-indigo-200 hover:bg-indigo-50">
            <Shuffle className="h-4 w-4 mr-2" />
            Shuffle Order
          </Button>
          <Button variant="default" size="sm" onClick={finalizeAndGrade} className="bg-primary hover:bg-primary/90 text-white rounded-full shadow-md">
            <Download className="h-4 w-4 mr-2" />
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
        {questions.map((q, idx) => (
          <Card key={q.id} className="overflow-hidden border-none shadow-md bg-white hover:shadow-lg transition-shadow rounded-2xl">
            <CardHeader className="border-b bg-slate-50/50 p-4 sm:p-8">
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="space-y-4 flex-1 w-full">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="bg-white font-mono text-[10px] px-2 py-0.5 shrink-0">QUESTION {idx + 1}</Badge>
                    {q.imageUrl && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] shrink-0">DIAGRAM INCLUDED</Badge>}
                    {q.sourceModel && (
                      <Badge className={`text-[10px] shrink-0 ${q.sourceModel.includes('openai') ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                        {q.sourceModel.includes('openai') ? 'GPT-4o' : 'Gemini 2.5'}
                      </Badge>
                    )}
                  </div>
                  {editingId === q.id ? (
                    <Textarea
                      value={q.question}
                      onChange={(e) => updateQuestionText(q.id, e.target.value)}
                      className="text-base sm:text-lg font-bold bg-white leading-relaxed min-h-[100px]"
                    />
                  ) : (
                    <h3 className="text-lg sm:text-xl font-bold text-slate-800 leading-relaxed">
                      {q.question}
                    </h3>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 self-end sm:self-start">
                  {editingId === q.id ? (
                    <Button variant="ghost" size="icon" onClick={handleSave} className="text-accent hover:bg-accent/10">
                      <Check className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(q.id)} className="text-slate-400 hover:text-primary hover:bg-primary/5">
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => deleteQuestion(q.id)} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {q.imageUrl && (
                <div className="mt-6 rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white p-2 relative group">
                  <div className="relative aspect-video w-full">
                    <img
                      src={q.imageUrl}
                      alt="Question diagram"
                      className="object-contain w-full h-full rounded-xl transition-transform duration-500 group-hover:scale-[1.01]"
                    />
                  </div>
                  {editingId === q.id && (
                    <Button
                      variant="destructive"
                      size="icon"
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
                      let className = "justify-start text-left h-auto py-3 sm:py-4 px-4 sm:px-6 rounded-xl transition-all duration-300 whitespace-normal ";

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

      {showGrade && (
        <div className="bg-white rounded-2xl shadow-2xl p-8 border-2 border-primary animate-in zoom-in-95 duration-500">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="58"
                  fill="none"
                  stroke="#f1f5f9"
                  strokeWidth="12"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="58"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeDasharray={364.42}
                  strokeDashoffset={364.42 - (364.42 * calculateScore().percentage) / 100}
                  className="text-primary transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-slate-800">{calculateScore().percentage}%</span>
              </div>
            </div>
            
            <div className="flex-1 space-y-2 text-center md:text-left">
              <h3 className="text-3xl font-black text-slate-800 font-headline">Test Results</h3>
              <p className="text-lg text-slate-500">
                You correctly answered <span className="font-bold text-primary">{calculateScore().score}</span> out of <span className="font-bold text-slate-700">{calculateScore().total}</span> questions.
              </p>
              <div className="flex flex-wrap gap-2 pt-2 justify-center md:justify-start">
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                  {calculateScore().score} Correct
                </Badge>
                <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                  {calculateScore().total - calculateScore().score} Incorrect
                </Badge>
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
          <Button variant="outline" className="w-full sm:w-auto rounded-full border-primary text-primary hover:bg-primary/5">
            <FileDown className="h-4 w-4 mr-2" />
            Export as PDF
          </Button>
          <Button onClick={finalizeAndGrade} className="w-full sm:w-auto rounded-full bg-primary hover:bg-primary/90 text-white px-8 h-12 text-lg shadow-lg">
            Finalize & Grade
          </Button>
        </div>
      </div>
    </div>
  );
}