"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { MAX_TIME_LIMIT_MINUTES, validateAssignmentOptions } from "@/lib/assignments";
import type { AssignmentOptions, ResultsRelease } from "@/lib/types";

/** ISO time → value for <input type="datetime-local"> in the user's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export const RESULTS_RELEASE_LABELS: Record<ResultsRelease, string> = {
  immediately: "Right after they submit",
  after_close: "When the assignment closes",
  manual: "When I release them",
};

const selectClass = "w-full h-10 px-3 rounded-md border border-input bg-white text-sm";

interface AssignmentFormProps {
  initial: AssignmentOptions;
  /** Called with valid options, or null while the form has a problem. */
  onChange: (options: AssignmentOptions | null, problem: string | null) => void;
}

/** The options shared by "Assign online" and editing an assignment. */
export function AssignmentForm({ initial, onChange }: AssignmentFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [opensAt, setOpensAt] = useState(toLocalInput(initial.opensAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(initial.closesAt));
  const [limit, setLimit] = useState(initial.timeLimitMinutes ? String(initial.timeLimitMinutes) : "");
  const [shuffleQuestions, setShuffle] = useState(initial.shuffleQuestions);
  const [resultsRelease, setRelease] = useState<ResultsRelease>(initial.resultsRelease);
  const [showCorrectAnswers, setShowCorrect] = useState(initial.showCorrectAnswers);

  const emit = (next: Partial<{ title: string; opensAt: string; closesAt: string; limit: string; shuffleQuestions: boolean; resultsRelease: ResultsRelease; showCorrectAnswers: boolean }>) => {
    const v = { title, opensAt, closesAt, limit, shuffleQuestions, resultsRelease, showCorrectAnswers, ...next };
    const options: AssignmentOptions = {
      title: v.title.trim(),
      opensAt: fromLocalInput(v.opensAt),
      closesAt: fromLocalInput(v.closesAt),
      timeLimitMinutes: v.limit.trim() === "" || Number(v.limit) === 0 ? null : Number(v.limit),
      shuffleQuestions: v.shuffleQuestions,
      resultsRelease: v.resultsRelease,
      showCorrectAnswers: v.showCorrectAnswers,
    };
    const problem = !options.title ? "Please give the assignment a title." : validateAssignmentOptions(options);
    onChange(problem ? null : options, problem);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="assignment-title" className="text-sm font-medium">
          Title students see
        </label>
        <Input
          id="assignment-title"
          value={title}
          maxLength={120}
          onChange={(e) => {
            setTitle(e.target.value);
            emit({ title: e.target.value });
          }}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="assignment-opens" className="text-sm font-medium">
            Opens (optional)
          </label>
          <Input
            id="assignment-opens"
            type="datetime-local"
            value={opensAt}
            onChange={(e) => {
              setOpensAt(e.target.value);
              emit({ opensAt: e.target.value });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="assignment-closes" className="text-sm font-medium">
            Closes (optional)
          </label>
          <Input
            id="assignment-closes"
            type="datetime-local"
            value={closesAt}
            onChange={(e) => {
              setClosesAt(e.target.value);
              emit({ closesAt: e.target.value });
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">Leave empty to open and close it yourself. Times are in your time zone.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="assignment-limit" className="text-sm font-medium">
            Time limit in minutes (optional)
          </label>
          <Input
            id="assignment-limit"
            type="number"
            min={0}
            max={MAX_TIME_LIMIT_MINUTES}
            step={1}
            placeholder="No limit"
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              emit({ limit: e.target.value });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="assignment-release" className="text-sm font-medium">
            Students see their results
          </label>
          <select
            id="assignment-release"
            className={selectClass}
            value={resultsRelease}
            onChange={(e) => {
              const value = e.target.value as ResultsRelease;
              setRelease(value);
              emit({ resultsRelease: value });
            }}
          >
            {(Object.keys(RESULTS_RELEASE_LABELS) as ResultsRelease[]).map((r) => (
              <option key={r} value={r}>
                {RESULTS_RELEASE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={showCorrectAnswers}
          onChange={(e) => {
            setShowCorrect(e.target.checked);
            emit({ showCorrectAnswers: e.target.checked });
          }}
        />
        Show correct answers and explanations with results
      </label>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={shuffleQuestions}
          onChange={(e) => {
            setShuffle(e.target.checked);
            emit({ shuffleQuestions: e.target.checked });
          }}
        />
        Shuffle question order for each student
      </label>
      <p className="text-xs text-muted-foreground -mt-2">Answer options are always shuffled for each student.</p>
    </div>
  );
}
