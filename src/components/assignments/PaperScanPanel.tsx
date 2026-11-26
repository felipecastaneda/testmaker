"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, Eye, Loader2, ScanLine, Trash2, Upload } from "lucide-react";
import { savePaperScan } from "@/app/actions/assignments";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { gradeAttempt, percentage } from "@/lib/grading";
import { idFromMarks, readSheet, type MarkFlag, type Point } from "@/lib/omr";
import {
  ID_CHARSETS,
  lettersToAnswers,
  lettersToText,
  normalizePaperId,
  parseTypedAnswers,
  type PaperExam,
  type PaperLetters,
} from "@/lib/paper";
import { optionLetter } from "@/lib/question-utils";
import { filePages, grayOf, storedImage } from "@/lib/scan-images";
import type { AssignmentSummary } from "@/lib/types";
import type { paperVariants } from "@/lib/paper";
import { ScanSheetView } from "./ScanSheetView";

type Variants = ReturnType<typeof paperVariants>;

interface Row {
  key: number;
  label: string;
  status: "error" | "ready" | "saving" | "saved";
  error?: string;
  image?: { url: string; base64: string; width: number; height: number; corners: Point[] };
  /** Version letter, or "" when the sheet's code strip wasn't recognised. */
  version: string;
  versionUnknown: boolean;
  studentId: string;
  idDoubtful: boolean;
  name: string;
  answersText: string;
  letters: PaperLetters | null;
  flags: (MarkFlag | null)[];
  reviewed: boolean;
  score?: string;
}

const FLAG_TEXT: Record<MarkFlag, string> = { multiple: "two marks", faint: "faint mark", unclear: "unclear" };

/** Why a row can't be saved yet, or null. */
function blocker(row: Row, exam: PaperExam, variants: Variants, rows: Row[]): string | null {
  if (row.status !== "ready") return null;
  if (!row.version) return "Choose the version: this sheet's code strip wasn't recognised (another exam, or damaged).";
  const id = normalizePaperId(row.studentId, exam.paper);
  if ("error" in id) return row.studentId ? id.error : "Enter the student ID (it couldn't be read).";
  const variant = variants.find((v) => v.label === row.version)!;
  const parsed = parseTypedAnswers(row.answersText, variant);
  if ("error" in parsed) return parsed.error;
  const dup = rows.find((r) => {
    if (r === row || r.status === "error") return false;
    const other = normalizePaperId(r.studentId, exam.paper);
    return "id" in other && other.id === id.id;
  });
  if (dup) return `Same student ID as ${dup.label}.`;
  if (!row.reviewed && exam.classList.length && !exam.classList.some((e) => e.id === id.id)) return "Not on the class list: check the ID.";
  if (!row.reviewed && (row.idDoubtful || row.versionUnknown || row.flags.some(Boolean))) return "Check this sheet.";
  return null;
}

interface PaperScanPanelProps {
  assignment: AssignmentSummary;
  exam: PaperExam;
  variants: Variants;
  onSaved: () => void;
}

/** Upload photos or PDFs of filled answer sheets, check what was read, and save them. */
export function PaperScanPanel({ assignment: a, exam, variants, onSaved }: PaperScanPanelProps) {
  const { callAction } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(1);
  const input = useRef<HTMLInputElement>(null);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const chars = ID_CHARSETS[exam.paper.idCharset];
  const optionCounts = variants.map((v) => v.questions.map((q) => q.options.length));

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setReading({ done: 0, total: files.length });
    for (const [i, file] of files.entries()) {
      let pages;
      try {
        pages = await filePages(file);
      } catch (error) {
        setRows((rs) => [...rs, emptyRow(nextKey.current++, file.name, (error as Error).message)]);
        setReading({ done: i + 1, total: files.length });
        continue;
      }
      for (const page of pages) {
        // Let the page repaint between sheets.
        await new Promise((r) => setTimeout(r, 0));
        const key = nextKey.current++;
        const result = readSheet(grayOf(page.canvas), { assignmentId: a.id, paper: exam.paper, optionCounts });
        if (!result.ok) {
          setRows((rs) => [...rs, emptyRow(key, page.label, result.error)]);
          continue;
        }
        const { sheet } = result;
        const image = await storedImage(page.canvas, sheet.corners);
        const id = idFromMarks(sheet.id, chars);
        const letters = sheet.answers.map((m) => m.value);
        setRows((rs) => [
          ...rs,
          {
            key,
            label: page.label,
            status: "ready",
            image,
            version: sheet.version === null ? (variants.length === 1 ? "A" : "") : variants[sheet.version].label,
            versionUnknown: sheet.version === null,
            studentId: id.id,
            idDoubtful: id.doubtful || !id.id,
            name: "",
            answersText: lettersToText(letters),
            letters,
            flags: sheet.answers.map((m) => m.flag),
            reviewed: false,
          },
        ]);
      }
      setReading({ done: i + 1, total: files.length });
    }
    setReading(null);
  };

  const saveRows = async (targets: Row[], replace: boolean): Promise<Row[]> => {
    const existing: Row[] = [];
    for (const row of targets) {
      const variant = variants.find((v) => v.label === row.version)!;
      const parsed = parseTypedAnswers(row.answersText, variant);
      const id = normalizePaperId(row.studentId, exam.paper);
      if ("error" in parsed || "error" in id || !row.image) continue;
      update(row.key, { status: "saving" });
      const result = await callAction((t) =>
        savePaperScan(
          t,
          a.id,
          { studentId: id.id, studentName: row.name, variant: row.version, letters: parsed.letters, replace },
          { imageBase64: row.image!.base64, width: row.image!.width, height: row.image!.height, corners: row.image!.corners }
        )
      );
      if (!result.success || !result.data) {
        update(row.key, { status: "ready" });
        toast({ title: `Couldn't save ${row.label}`, description: result.error, variant: "destructive" });
        continue;
      }
      if (!result.data.saved) {
        update(row.key, { status: "ready" });
        existing.push(row);
        continue;
      }
      update(row.key, { status: "saved", score: `${result.data.earned} / ${result.data.possible} (${percentage(result.data.earned, result.data.possible)}%)` });
    }
    return existing;
  };

  const saveAll = async () => {
    const ready = rows.filter((r) => r.status === "ready" && !blocker(r, exam, variants, rows));
    if (!ready.length) return;
    setSaving(true);
    const existing = await saveRows(ready, false);
    if (existing.length && confirm(`${existing.length} of these students already have answers saved (${existing.map((r) => r.studentId).join(", ")}). Replace them with these scans?`)) {
      await saveRows(existing, true);
    }
    setSaving(false);
    onSaved();
  };

  const visible = rows;
  const readyCount = rows.filter((r) => r.status === "ready" && !blocker(r, exam, variants, rows)).length;
  const toCheck = rows.filter((r) => r.status === "ready" && blocker(r, exam, variants, rows)).length;
  const savedCount = rows.filter((r) => r.status === "saved").length;
  const current = rows.find((r) => r.key === open) ?? null;

  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4" aria-label="Scan sheets">
      <div className="flex items-center gap-2">
        <ScanLine className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-800">Scan sheets</h2>
      </div>
      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors ${dragging ? "border-primary bg-primary/5" : "border-slate-200"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <p className="text-slate-600">
          Drop photos of the filled answer sheets, or a PDF from a scanner (one sheet per page).
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Lay each sheet flat in good light with all four black corner squares in the picture. Sheets are read on this computer; each image is
          saved with the student&apos;s answers so you can look at it later.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          className="sr-only"
          aria-label="Answer sheet files"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Button variant="outline" className="mt-3" onClick={() => input.current?.click()} disabled={!!reading}>
          {reading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
          {reading ? `Reading ${reading.done} of ${reading.total}…` : "Choose files"}
        </Button>
      </div>

      {visible.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600" data-testid="scan-summary">
              {readyCount} ready · {toCheck} to check · {savedCount} saved
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((r) => r.status !== "saved"))} disabled={!savedCount || saving}>
                Clear saved
              </Button>
              <Button size="sm" onClick={saveAll} disabled={!readyCount || saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                Save {readyCount} {readyCount === 1 ? "sheet" : "sheets"}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm" aria-label="Scanned sheets">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Sheet</th>
                  <th className="text-left font-semibold px-3 py-2">Student ID</th>
                  <th className="text-left font-semibold px-3 py-2">Version</th>
                  <th className="text-left font-semibold px-3 py-2">Answers</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => {
                  const problem = blocker(row, exam, variants, rows);
                  const locked = row.status === "saved" || row.status === "saving";
                  return (
                    <tr key={row.key} data-testid="scan-row">
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-[160px] truncate" title={row.label}>
                        {row.label}
                      </td>
                      {row.status === "error" ? (
                        <td colSpan={4} className="px-3 py-2 text-xs text-rose-600" data-testid="scan-error">
                          {row.error}
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-2">
                            <Input
                              value={row.studentId}
                              disabled={locked}
                              aria-label={`Student ID for ${row.label}`}
                              className={`h-8 w-32 font-mono uppercase ${row.idDoubtful && !row.reviewed ? "border-amber-400" : ""}`}
                              onChange={(e) => update(row.key, { studentId: e.target.value, idDoubtful: false })}
                            />
                            {listedName(row.studentId, exam) && <span className="block text-[11px] text-emerald-700 mt-0.5">{listedName(row.studentId, exam)}</span>}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={row.version}
                              disabled={locked}
                              aria-label={`Version for ${row.label}`}
                              className={`h-8 px-2 rounded-md border bg-white text-sm ${!row.version ? "border-amber-400" : "border-input"}`}
                              onChange={(e) => update(row.key, { version: e.target.value })}
                            >
                              {!row.version && <option value="">?</option>}
                              {variants.map((v) => (
                                <option key={v.label} value={v.label}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.answersText}
                              disabled={locked}
                              spellCheck={false}
                              aria-label={`Answers for ${row.label}`}
                              className="h-8 min-w-[180px] font-mono uppercase tracking-wider"
                              onChange={(e) => update(row.key, { answersText: e.target.value, flags: row.flags.map(() => null) })}
                            />
                            {row.flags.some(Boolean) && !row.reviewed && (
                              <span className="block text-[11px] text-amber-700 mt-0.5">
                                {row.flags
                                  .map((f, q) => (f ? `Q${q + 1}: ${FLAG_TEXT[f]}` : null))
                                  .filter(Boolean)
                                  .slice(0, 4)
                                  .join(" · ")}
                                {row.flags.filter(Boolean).length > 4 ? " · …" : ""}
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2 text-xs whitespace-nowrap" data-testid="scan-status">
                        {row.status === "saved" ? (
                          <span className="text-emerald-700">Saved · {row.score}</span>
                        ) : row.status === "saving" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : row.status === "error" ? (
                          <span className="text-rose-600">Not read</span>
                        ) : problem ? (
                          <span className="inline-flex items-center gap-1 text-amber-700" title={problem}>
                            <AlertTriangle className="h-3.5 w-3.5" /> {problem.length > 40 ? "Check" : problem}
                          </span>
                        ) : (
                          <span className="text-slate-600">Ready{previewScore(row, exam, variants)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-right">
                        {row.image && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(row.key)} aria-label={`Check ${row.label}`}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Check
                          </Button>
                        )}
                        {row.status !== "saved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-slate-500 hover:text-rose-600"
                            onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                            aria-label={`Remove ${row.label}`}
                            disabled={row.status === "saving"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {current?.image && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[95vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{current.label}</DialogTitle>
              <DialogDescription>
                Green circles are the answers that will be counted; amber ones need a look. Fix the ID or answers in the table if anything is wrong.
              </DialogDescription>
            </DialogHeader>
            <div className="grid md:grid-cols-[1fr_220px] gap-4">
              <ScanSheetView
                src={current.image.url}
                width={current.image.width}
                height={current.image.height}
                corners={current.image.corners}
                paper={exam.paper}
                optionCounts={optionCounts[Math.max(0, variants.findIndex((v) => v.label === current.version))]}
                letters={lettersFor(current, variants)}
                flags={current.reviewed ? undefined : current.flags}
              />
              <div className="space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Student ID</span>
                  <span className="block font-mono text-base">{current.studentId || "—"}</span>
                  {current.idDoubtful && <span className="text-xs text-amber-700">Couldn&apos;t read every character: compare with the written ID.</span>}
                </p>
                <p>
                  <span className="text-muted-foreground">Version</span>
                  <span className="block font-semibold">{current.version || "?"}</span>
                  {current.versionUnknown && <span className="text-xs text-amber-700">The sheet&apos;s code strip isn&apos;t this exam&apos;s. Is it the right exam?</span>}
                </p>
                <ul className="text-xs space-y-0.5">
                  {current.flags.map((f, q) =>
                    f && !current.reviewed ? (
                      <li key={q} className="text-amber-700">
                        Q{q + 1}: {FLAG_TEXT[f]} {current.letters?.[q] !== null && current.letters?.[q] !== undefined ? `(read ${optionLetter(current.letters[q]!)})` : ""}
                      </li>
                    ) : null
                  )}
                </ul>
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    onClick={() => {
                      update(current.key, { reviewed: true, idDoubtful: false, versionUnknown: false });
                      setOpen(null);
                    }}
                    disabled={current.status === "saved"}
                  >
                    <Check className="h-4 w-4 mr-1" /> Looks right
                  </Button>
                  <Button variant="ghost" onClick={() => setOpen(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function emptyRow(key: number, label: string, error: string): Row {
  return { key, label, status: "error", error, version: "", versionUnknown: false, studentId: "", idDoubtful: false, name: "", answersText: "", letters: null, flags: [], reviewed: false };
}

/** Letters as currently typed in the row (for the overlay), falling back to what was read. */
function lettersFor(row: Row, variants: Variants): PaperLetters {
  const variant = variants.find((v) => v.label === row.version) ?? variants[0];
  const parsed = parseTypedAnswers(row.answersText, variant);
  return "letters" in parsed ? parsed.letters : (row.letters ?? []);
}

function previewScore(row: Row, exam: PaperExam, variants: Variants): string {
  const variant = variants.find((v) => v.label === row.version);
  if (!variant) return "";
  const parsed = parseTypedAnswers(row.answersText, variant);
  if ("error" in parsed) return "";
  const g = gradeAttempt(exam.questions, lettersToAnswers(variant, parsed.letters));
  return ` · ${g.earned} / ${g.possible} (${percentage(g.earned, g.possible)}%)`;
}

/** The class-list name for a typed or read ID, if any. */
function listedName(studentId: string, exam: PaperExam): string | null {
  const id = normalizePaperId(studentId, exam.paper);
  return "id" in id ? (exam.classList.find((e) => e.id === id.id)?.name ?? null) : null;
}
