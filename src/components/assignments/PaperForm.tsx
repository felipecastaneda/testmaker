"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PAPER_DEFAULTS, PAPER_ID_MAX, PAPER_ID_MIN, PAPER_MAX_VERSIONS, paperProblem } from "@/lib/paper";
import type { PaperIdCharset, PaperOptions, QuestionData } from "@/lib/types";

const selectClass = "w-full h-10 px-3 rounded-md border border-input bg-white text-sm";

/** Problem with these paper settings, or null. */
export function checkPaper(title: string, paper: PaperOptions, questions: QuestionData[]): string | null {
  if (!title.trim()) return "Please give the exam a title.";
  if (!Number.isInteger(paper.idLength) || paper.idLength < PAPER_ID_MIN || paper.idLength > PAPER_ID_MAX) {
    return `Student ID length must be ${PAPER_ID_MIN}–${PAPER_ID_MAX} characters.`;
  }
  return paperProblem(questions, paper.idCharset);
}

interface PaperFormProps {
  title: string;
  questions: QuestionData[];
  onChange: (title: string, paper: PaperOptions | null, problem: string | null) => void;
}

/** Options for a paper exam: versions and the student-ID grid on the answer sheet. */
export function PaperForm({ title: initialTitle, questions, onChange }: PaperFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [versions, setVersions] = useState(PAPER_DEFAULTS.versions);
  const [idCharset, setCharset] = useState<PaperIdCharset>(PAPER_DEFAULTS.idCharset);
  const [idLength, setIdLength] = useState(String(PAPER_DEFAULTS.idLength));

  const emit = (next: Partial<{ title: string; versions: number; idCharset: PaperIdCharset; idLength: string }>) => {
    const v = { title, versions, idCharset, idLength, ...next };
    const paper: PaperOptions = { versions: v.versions, idCharset: v.idCharset, idLength: Number(v.idLength) };
    const problem = checkPaper(v.title, paper, questions);
    onChange(v.title.trim(), problem ? null : paper, problem);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="paper-title" className="text-sm font-medium">
          Title on the exam
        </label>
        <Input
          id="paper-title"
          value={title}
          maxLength={120}
          onChange={(e) => {
            setTitle(e.target.value);
            emit({ title: e.target.value });
          }}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="paper-versions" className="text-sm font-medium">
          Versions
        </label>
        <select
          id="paper-versions"
          className={selectClass}
          value={versions}
          onChange={(e) => {
            setVersions(Number(e.target.value));
            emit({ versions: Number(e.target.value) });
          }}
        >
          {Array.from({ length: PAPER_MAX_VERSIONS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "1 (everyone gets the same exam)" : `${n} (${"ABCD".slice(0, n).split("").join(", ")})`}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Each version has its own question and answer order, so neighbours can&apos;t copy.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="paper-id-charset" className="text-sm font-medium">
            Student IDs use
          </label>
          <select
            id="paper-id-charset"
            className={selectClass}
            value={idCharset}
            onChange={(e) => {
              setCharset(e.target.value as PaperIdCharset);
              emit({ idCharset: e.target.value as PaperIdCharset });
            }}
          >
            <option value="letters_digits">Letters and digits</option>
            <option value="digits">Digits only</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="paper-id-length" className="text-sm font-medium">
            Characters in an ID
          </label>
          <Input
            id="paper-id-length"
            type="number"
            min={PAPER_ID_MIN}
            max={PAPER_ID_MAX}
            value={idLength}
            onChange={(e) => {
              setIdLength(e.target.value);
              emit({ idLength: e.target.value });
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Students write their ID and fill one bubble per character on the answer sheet. Use the length of your longest ID; shorter IDs leave the
        rest blank. Digits only leaves room for up to 100 questions (75 with letters).
      </p>
    </div>
  );
}
