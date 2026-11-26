"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Monitor, Printer } from "lucide-react";
import { createAssignment } from "@/app/actions/assignments";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useCourses } from "@/hooks/use-courses";
import { DEFAULT_MAX_STUDENTS } from "@/lib/assignments";
import type { AssignmentOptions, Delivery, PaperOptions, QuestionData } from "@/lib/types";
import { AssignmentForm } from "./AssignmentForm";
import { checkPaper, PaperForm } from "./PaperForm";
import { PAPER_DEFAULTS } from "@/lib/paper";

interface AssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  testName: string;
  courseId: string | null;
  questions: QuestionData[];
}

/** Turn a saved test into an assignment (a frozen copy of its current questions), online or on paper. */
export function AssignDialog({ open, onOpenChange, testId, testName, courseId, questions }: AssignDialogProps) {
  const { callAction } = useAuth();
  const { overview } = useCourses();
  const router = useRouter();
  const defaults = overview?.courses.find((c) => c.id === courseId)?.assignmentDefaults;
  const modes = defaults?.deliveryModes ?? "both";
  const initial: AssignmentOptions = {
    title: testName,
    opensAt: null,
    closesAt: null,
    timeLimitMinutes: defaults?.timeLimitMinutes ?? null,
    shuffleQuestions: false,
    resultsRelease: defaults?.resultsRelease ?? "after_close",
    showCorrectAnswers: defaults?.showCorrectAnswers ?? true,
    maxStudents: DEFAULT_MAX_STUDENTS,
  };
  const [chosen, setChosen] = useState<Delivery | null>(null);
  const delivery: Delivery = modes === "both" ? (chosen ?? "online") : modes;
  // Until the professor edits something, use the (possibly late-arriving) course defaults.
  const [edited, setEdited] = useState<{ options: AssignmentOptions | null; problem: string | null } | null>(null);
  const [paper, setPaper] = useState<{ title: string; paper: PaperOptions | null; problem: string | null }>(() => {
    const p = checkPaper(testName, PAPER_DEFAULTS, questions);
    return { title: testName, paper: p ? null : PAPER_DEFAULTS, problem: p };
  });
  const options = edited ? edited.options : initial;
  const problem = delivery === "paper" ? paper.problem : (edited?.problem ?? null);
  const [busy, setBusy] = useState(false);

  const create = async (openNow: boolean) => {
    const isPaper = delivery === "paper";
    if (isPaper ? !paper.paper : !options) return;
    setBusy(true);
    const result = await callAction((t) =>
      isPaper ? createAssignment(t, testId, { ...(options ?? initial), title: paper.title }, false, paper.paper) : createAssignment(t, testId, options!, openNow)
    );
    setBusy(false);
    if (!result.success || !result.data) {
      toast({ title: "Couldn't create the assignment", description: result.error, variant: "destructive" });
      return;
    }
    toast(
      isPaper
        ? { title: "Paper exam created", description: "Print the booklets and answer sheets from its page." }
        : { title: openNow ? "Assignment is open" : "Assignment saved as a draft", description: "Share the link or join code with your students." }
    );
    onOpenChange(false);
    router.push(`/assignments/${result.data}`);
  };

  const choice = (value: Delivery, label: string, Icon: typeof Monitor, help: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={delivery === value}
      onClick={() => setChosen(value)}
      className={`flex-1 text-left rounded-xl border p-3 transition-colors ${delivery === value ? "border-primary bg-primary/5" : "border-slate-200 hover:border-slate-300"}`}
    >
      <span className="flex items-center gap-2 font-medium text-sm">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="block text-xs text-muted-foreground mt-0.5">{help}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{delivery === "paper" ? "Assign on paper" : "Assign online"}</DialogTitle>
          <DialogDescription>
            {delivery === "paper"
              ? `Print these ${questions.length} questions with bubble answer sheets, then enter or scan the answers to grade them.`
              : `Students take these ${questions.length} questions online.`}{" "}
            Later edits to the test won&apos;t change this assignment.
          </DialogDescription>
        </DialogHeader>
        {modes === "both" && (
          <div className="flex gap-2" role="radiogroup" aria-label="How students take it">
            {choice("online", "Online", Monitor, "Students join with a link or code.")}
            {choice("paper", "Paper", Printer, "Printed exam and answer sheets.")}
          </div>
        )}
        {delivery === "paper" ? (
          <PaperForm title={testName} questions={questions} onChange={(title, p, prob) => setPaper({ title, paper: p, problem: prob })} />
        ) : (
          /* Keyed on the course defaults so they apply once course data arrives. */
          <AssignmentForm
            key={JSON.stringify(defaults ?? null)}
            initial={initial}
            onChange={(o, p) => setEdited({ options: o, problem: p })}
          />
        )}
        {problem && <p className="text-sm text-rose-600" role="alert">{problem}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {delivery === "paper" ? (
            <Button onClick={() => create(false)} disabled={busy || !paper.paper}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create paper exam"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => create(false)} disabled={busy || !options}>
                Save as draft
              </Button>
              <Button onClick={() => create(true)} disabled={busy || !options}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create and open"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
