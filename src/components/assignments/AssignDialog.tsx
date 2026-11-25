"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createAssignment } from "@/app/actions/assignments";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useCourses } from "@/hooks/use-courses";
import { DEFAULT_MAX_STUDENTS } from "@/lib/assignments";
import type { AssignmentOptions } from "@/lib/types";
import { AssignmentForm } from "./AssignmentForm";

interface AssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  testName: string;
  courseId: string | null;
  questionCount: number;
}

/** Turn a saved test into an online assignment (a frozen copy of its current questions). */
export function AssignDialog({ open, onOpenChange, testId, testName, courseId, questionCount }: AssignDialogProps) {
  const { callAction } = useAuth();
  const { overview } = useCourses();
  const router = useRouter();
  const defaults = overview?.courses.find((c) => c.id === courseId)?.assignmentDefaults;
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
  // Until the professor edits something, use the (possibly late-arriving) course defaults.
  const [edited, setEdited] = useState<{ options: AssignmentOptions | null; problem: string | null } | null>(null);
  const options = edited ? edited.options : initial;
  const problem = edited?.problem ?? null;
  const [busy, setBusy] = useState(false);

  const create = async (openNow: boolean) => {
    if (!options) return;
    setBusy(true);
    const result = await callAction((t) => createAssignment(t, testId, options, openNow));
    setBusy(false);
    if (!result.success || !result.data) {
      toast({ title: "Couldn't create the assignment", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: openNow ? "Assignment is open" : "Assignment saved as a draft", description: "Share the link or join code with your students." });
    onOpenChange(false);
    router.push(`/assignments/${result.data}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign online</DialogTitle>
          <DialogDescription>
            Students take these {questionCount} questions online. Later edits to the test won&apos;t change this assignment.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed on the course defaults so they apply once course data arrives. */}
        <AssignmentForm
          key={JSON.stringify(defaults ?? null)}
          initial={initial}
          onChange={(o, p) => setEdited({ options: o, problem: p })}
        />
        {problem && <p className="text-sm text-rose-600" role="alert">{problem}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => create(false)} disabled={busy || !options}>
            Save as draft
          </Button>
          <Button onClick={() => create(true)} disabled={busy || !options}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create and open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
