"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { MAX_STUDENTS_LIMIT, MAX_TIME_LIMIT_MINUTES, validateAssignmentOptions } from "@/lib/assignments";
import { domainHint, IDENTITY_LABELS, type StudentIdentity } from "@/lib/student-identity";
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
  /** The organization fixed how students identify themselves. */
  identityLocked?: boolean;
  /** Allowed email domains for Google sign-in (shown as a hint). */
  allowedDomains?: string[];
}

/** The options shared by "Assign online" and editing an assignment. */
export function AssignmentForm({ initial, onChange, identityLocked = false, allowedDomains = [] }: AssignmentFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [opensAt, setOpensAt] = useState(toLocalInput(initial.opensAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(initial.closesAt));
  const [limit, setLimit] = useState(initial.timeLimitMinutes ? String(initial.timeLimitMinutes) : "");
  const [shuffleQuestions, setShuffle] = useState(initial.shuffleQuestions);
  const [resultsRelease, setRelease] = useState<ResultsRelease>(initial.resultsRelease);
  const [showCorrectAnswers, setShowCorrect] = useState(initial.showCorrectAnswers);
  const [maxStudents, setMaxStudents] = useState(String(initial.maxStudents));
  const [identity, setIdentity] = useState<StudentIdentity>(initial.identity);
  const [askStudentId, setAskStudentId] = useState(initial.askStudentId);

  const emit = (
    next: Partial<{
      title: string;
      opensAt: string;
      closesAt: string;
      limit: string;
      shuffleQuestions: boolean;
      resultsRelease: ResultsRelease;
      showCorrectAnswers: boolean;
      maxStudents: string;
      identity: StudentIdentity;
      askStudentId: boolean;
    }>
  ) => {
    const v = { title, opensAt, closesAt, limit, shuffleQuestions, resultsRelease, showCorrectAnswers, maxStudents, identity, askStudentId, ...next };
    const max = Number(v.maxStudents);
    const options: AssignmentOptions = {
      title: v.title.trim(),
      opensAt: fromLocalInput(v.opensAt),
      closesAt: fromLocalInput(v.closesAt),
      timeLimitMinutes: v.limit.trim() === "" || Number(v.limit) === 0 ? null : Number(v.limit),
      shuffleQuestions: v.shuffleQuestions,
      resultsRelease: v.resultsRelease,
      showCorrectAnswers: v.showCorrectAnswers,
      maxStudents: max,
      identity: v.identity,
      askStudentId: v.askStudentId,
    };
    const problem = !options.title
      ? "Please give the assignment a title."
      : !Number.isInteger(max) || max < 1 || max > MAX_STUDENTS_LIMIT
        ? `Maximum students must be a whole number between 1 and ${MAX_STUDENTS_LIMIT}.`
        : validateAssignmentOptions(options);
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

      <div className="space-y-1.5">
        <label htmlFor="assignment-identity" className="text-sm font-medium">
          Students identify themselves with
        </label>
        <select
          id="assignment-identity"
          className={selectClass}
          value={identity}
          disabled={identityLocked}
          onChange={(e) => {
            const value = e.target.value as StudentIdentity;
            setIdentity(value);
            emit({ identity: value });
          }}
        >
          {(Object.keys(IDENTITY_LABELS) as StudentIdentity[]).map((k) => (
            <option key={k} value={k}>
              {IDENTITY_LABELS[k]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {identity === "google"
            ? `Students sign in with Google${allowedDomains.length ? ` (${domainHint(allowedDomains)} accounts only)` : ""}, so nobody can start in someone else's name, and they can continue on another device.`
            : "Students type their name and student ID. Quick, but anyone could type someone else's ID."}
          {identityLocked ? " Set by your organization." : ""}
        </p>
        {identity === "google" && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={askStudentId}
              onChange={(e) => {
                setAskStudentId(e.target.checked);
                emit({ askStudentId: e.target.checked });
              }}
            />
            Also ask for their student ID
          </label>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="assignment-max-students" className="text-sm font-medium">
          Maximum students
        </label>
        <Input
          id="assignment-max-students"
          type="number"
          min={1}
          max={MAX_STUDENTS_LIMIT}
          step={1}
          className="sm:w-40"
          value={maxStudents}
          onChange={(e) => {
            setMaxStudents(e.target.value);
            emit({ maxStudents: e.target.value });
          }}
        />
        <p className="text-xs text-muted-foreground">Set it a little above your class size, so made-up student IDs can&apos;t fill the exam.</p>
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
