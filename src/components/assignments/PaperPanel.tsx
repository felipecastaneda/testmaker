"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Loader2, Printer } from "lucide-react";
import { getPaperExam, savePaperAnswers } from "@/app/actions/assignments";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { gradeAttempt, percentage } from "@/lib/grading";
import { lettersToAnswers, normalizePaperId, paperVariants, parseTypedAnswers, type PaperExam } from "@/lib/paper";
import { MAX_SHEETS_PER_VERSION, paperPrintHtml } from "@/lib/paper-print";
import type { AssignmentSummary } from "@/lib/types";


const selectClass = "h-10 px-3 rounded-md border border-input bg-white text-sm";

interface PaperPanelProps {
  assignment: AssignmentSummary;
  courseName?: string;
  /** Called after answers are saved, to refresh the gradebook. */
  onSaved: () => void;
}

/** Print a paper exam and type in students' answers. */
export function PaperPanel({ assignment: a, courseName, onSaved }: PaperPanelProps) {
  const { callAction } = useAuth();
  const [exam, setExam] = useState<PaperExam | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callAction((t) => getPaperExam(t, a.id));
    if (result.success && result.data) setExam(result.data);
    else setError(result.error ?? "Couldn't load the exam.");
  }, [callAction, a.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const variants = useMemo(() => (exam ? paperVariants(exam.questions, exam.paper.versions, exam.seed) : []), [exam]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!exam) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;

  return (
    <>
      <PrintSection assignment={a} courseName={courseName} exam={exam} variants={variants} />
      {a.canEdit && <TypeAnswersSection assignment={a} exam={exam} variants={variants} onSaved={onSaved} />}
    </>
  );
}

type Variants = ReturnType<typeof paperVariants>;

function PrintSection({ assignment: a, courseName, exam, variants }: { assignment: AssignmentSummary; courseName?: string; exam: PaperExam; variants: Variants }) {
  const [booklets, setBooklets] = useState(true);
  const [sheets, setSheets] = useState("30");
  const [keys, setKeys] = useState(true);
  const sheetCount = Number(sheets);
  const sheetsOk = Number.isInteger(sheetCount) && sheetCount >= 0 && sheetCount <= MAX_SHEETS_PER_VERSION;

  const print = () => {
    const html = paperPrintHtml({
      assignmentId: a.id,
      title: exam.title,
      subtitle: courseName ?? "",
      paper: exam.paper,
      variants,
      booklets,
      sheetsPerVersion: sheetCount,
      keys,
    });
    const win = window.open("", "_blank");
    if (!win) {
      toast({ title: "Allow pop-ups to print", description: "Your browser blocked the print window.", variant: "destructive" });
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const many = exam.paper.versions > 1;
  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4" aria-label="Print">
      <h2 className="text-lg font-semibold text-slate-800">Print</h2>
      <div className="grid sm:grid-cols-3 gap-4 text-sm">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={booklets} onChange={(e) => setBooklets(e.target.checked)} />
          <span>
            <span className="font-medium block">Question booklets</span>
            <span className="text-xs text-muted-foreground">{many ? `One of each version (${variants.map((v) => v.label).join(", ")}); copy as needed.` : "One copy; photocopy as needed."}</span>
          </span>
        </label>
        <div className="space-y-1">
          <label htmlFor="sheets-per-version" className="font-medium block">
            Answer sheets {many ? "per version" : ""}
          </label>
          <Input id="sheets-per-version" type="number" min={0} max={MAX_SHEETS_PER_VERSION} value={sheets} onChange={(e) => setSheets(e.target.value)} className="w-28" />
          <span className="text-xs text-muted-foreground block">Printed with the version already marked. Don&apos;t photocopy sheets of another exam.</span>
        </div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={keys} onChange={(e) => setKeys(e.target.checked)} />
          <span>
            <span className="font-medium block">Answer keys</span>
            <span className="text-xs text-muted-foreground">For you; not for students.</span>
          </span>
        </label>
      </div>
      {!sheetsOk && <p className="text-sm text-rose-600">Answer sheets: 0–{MAX_SHEETS_PER_VERSION}.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={print} disabled={!sheetsOk || (!booklets && !keys && sheetCount === 0)}>
          <Printer className="h-4 w-4 mr-1" /> Open print view
        </Button>
        <p className="text-xs text-muted-foreground">Print at 100% (&quot;Actual size&quot;) on Letter or A4. Choose &quot;Save as PDF&quot; to keep a copy.</p>
      </div>
    </section>
  );
}

function TypeAnswersSection({ assignment: a, exam, variants, onSaved }: { assignment: AssignmentSummary; exam: PaperExam; variants: Variants; onSaved: () => void }) {
  const { callAction } = useAuth();
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState(variants[0]?.label ?? "A");
  const [answers, setAnswers] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);

  const variant = variants.find((v) => v.label === version) ?? variants[0];
  const parsed = parseTypedAnswers(answers, variant);
  const id = normalizePaperId(studentId, exam.paper);
  const answered = "letters" in parsed ? parsed.letters.filter((l) => l !== null).length : 0;
  const preview = "letters" in parsed ? gradeAttempt(exam.questions, lettersToAnswers(variant, parsed.letters)) : null;
  const problem = studentId.trim() && "error" in id ? id.error : "error" in parsed ? parsed.error : null;
  const canSave = !busy && studentId.trim() !== "" && !("error" in id) && "letters" in parsed;

  const save = async (replace = false): Promise<void> => {
    if (!("letters" in parsed) || "error" in id) return;
    setBusy(true);
    const result = await callAction((t) =>
      savePaperAnswers(t, a.id, { studentId: id.id, studentName: name, variant: variant.label, letters: parsed.letters, replace })
    );
    setBusy(false);
    if (!result.success || !result.data) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    if (!result.data.saved) {
      const who = result.data.existing.studentName || result.data.existing.studentId;
      if (confirm(`Answers for ${who} (${result.data.existing.studentId}) are already saved. Replace them with these?`)) return save(true);
      return;
    }
    const { earned, possible } = result.data;
    toast({ title: `Saved ${name.trim() || id.id}`, description: `${earned} / ${possible} (${percentage(earned, possible)}%)` });
    setStudentId("");
    setName("");
    setAnswers("");
    onSaved();
    idRef.current?.focus();
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4" aria-label="Type answers">
      <div className="flex items-center gap-2">
        <Keyboard className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-800">Type answers</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        One student at a time: type the letters they marked, in order (spaces are ignored; use <span className="font-mono">-</span> for a blank). Enter saves and
        moves to the next student. Scanning sheets comes next.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <div className="space-y-1">
          <label htmlFor="paper-student-id" className="text-sm font-medium">
            Student ID
          </label>
          <Input
            id="paper-student-id"
            ref={idRef}
            value={studentId}
            maxLength={40}
            autoComplete="off"
            className="font-mono uppercase"
            onChange={(e) => setStudentId(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="paper-student-name" className="text-sm font-medium">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input id="paper-student-name" value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="paper-version" className="text-sm font-medium">
            Version
          </label>
          <select id="paper-version" className={`${selectClass} w-full`} value={version} onChange={(e) => setVersion(e.target.value)} disabled={variants.length < 2}>
            {variants.map((v) => (
              <option key={v.label} value={v.label}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-3">
          <label htmlFor="paper-answers" className="text-sm font-medium">
            Answers
          </label>
          <Input
            id="paper-answers"
            value={answers}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase tracking-widest"
            placeholder={variant.questions.map((q) => (q.options.length === 2 ? "A" : "C")).join("").slice(0, 20)}
            onChange={(e) => setAnswers(e.target.value)}
          />
          <p className="text-xs text-muted-foreground" data-testid="typed-preview">
            {answered} of {variant.questions.length} answered
            {preview && answered > 0 ? ` · ${preview.earned} / ${preview.possible} (${percentage(preview.earned, preview.possible)}%)` : ""}
          </p>
        </div>
        {problem && (
          <p className="text-sm text-rose-600 sm:col-span-3" role="alert">
            {problem}
          </p>
        )}
        <div className="sm:col-span-3">
          <Button type="submit" disabled={!canSave}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save and next"}
          </Button>
        </div>
      </form>
    </section>
  );
}
