"use client";

import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  buildVariants,
  downloadBlob,
  fileSafeName,
  toAiken,
  toDocx,
  toGift,
  toPlainText,
  toPrintableHtml,
} from "@/lib/exporters";
import type { QuestionData } from "@/lib/types";

type Format = "pdf" | "docx" | "txt" | "gift" | "aiken";

const FORMATS: { id: Format; label: string; help: string; variants: boolean }[] = [
  { id: "pdf", label: "PDF (print)", help: "Opens a print-ready page with an answer key. Choose \"Save as PDF\" in the print dialog.", variants: true },
  { id: "docx", label: "Word (.docx)", help: "Editable Word document with an answer key.", variants: true },
  { id: "txt", label: "Plain text", help: "Simple text file with answers and explanations.", variants: true },
  { id: "gift", label: "Moodle (GIFT)", help: "Import into a Moodle question bank. Keeps explanations as feedback.", variants: false },
  { id: "aiken", label: "Moodle (Aiken)", help: "Simplest Moodle import format, also accepted by several other LMSs.", variants: false },
];

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  questions: QuestionData[];
}

export function ExportDialog({ open, onOpenChange, title, questions }: ExportDialogProps) {
  const [format, setFormat] = useState<Format>("pdf");
  const [versions, setVersions] = useState(1);
  const [busy, setBusy] = useState(false);
  const active = FORMATS.find((f) => f.id === format)!;
  const fileBase = fileSafeName(title);

  const run = async () => {
    setBusy(true);
    try {
      const variants = buildVariants(questions, active.variants ? versions : 1);
      switch (format) {
        case "pdf": {
          const win = window.open("", "_blank");
          if (!win) {
            toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to export the PDF.", variant: "destructive" });
            return;
          }
          win.document.open();
          win.document.write(toPrintableHtml(title, variants));
          win.document.close();
          break;
        }
        case "docx":
          downloadBlob(await toDocx(title, variants), `${fileBase}.docx`);
          break;
        case "txt":
          downloadBlob(new Blob([toPlainText(title, variants)], { type: "text/plain;charset=utf-8" }), `${fileBase}.txt`);
          break;
        case "gift":
          downloadBlob(new Blob([toGift(title, questions)], { type: "text/plain;charset=utf-8" }), `${fileBase}.gift.txt`);
          break;
        case "aiken":
          downloadBlob(new Blob([toAiken(questions)], { type: "text/plain;charset=utf-8" }), `${fileBase}.aiken.txt`);
          break;
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast({ title: "Export failed", description: "Something went wrong while building the file.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export test</DialogTitle>
          <DialogDescription>{questions.length} questions from &quot;{title}&quot;</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Export format">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                onClick={() => setFormat(f.id)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${format === f.id ? "border-primary bg-primary/5 text-primary" : "border-slate-200 hover:border-primary/40"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{active.help}</p>

          {active.variants && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Versions</p>
              <div className="flex gap-2" role="radiogroup" aria-label="Number of versions">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={versions === n}
                    onClick={() => setVersions(n)}
                    className={`h-9 min-w-[3.5rem] rounded-lg border px-3 text-sm font-medium ${versions === n ? "border-primary bg-primary text-white" : "border-slate-200 hover:border-primary/40"}`}
                  >
                    {n === 1 ? "1" : `A–${String.fromCharCode(64 + n)}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {versions === 1
                  ? "A single version."
                  : "Each version shuffles the question and answer order and gets its own answer key, so neighbours can't copy."}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={run} disabled={busy || questions.length === 0} className="rounded-full">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
