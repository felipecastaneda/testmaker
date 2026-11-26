import { z } from "zod";
import { AVAILABLE_MODELS } from "@/ai/models";

/**
 * Every setting TestMaker knows about, in one place. Shared by the server (validation,
 * enforcement) and the Settings page (rendering). A setting is only added here once the
 * feature it controls exists, so the page never shows a switch that does nothing.
 *
 * Values are stored per scope:
 *   orgs/{orgId}.settings       = { values: { [key]: value }, locked: [key, ...] }
 *   courses/{courseId}.settings = { values: { [key]: value } }
 * and resolved as  registry default → org value → course value (unless the org locked it).
 */

export type SettingScope = "org" | "course";
export type SettingGroup = "generation" | "questions" | "assignments" | "courses";

type Input =
  | { kind: "boolean" }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "text"; maxLength: number; placeholder?: string }
  | { kind: "number"; min: number; max: number; step: number }
  | { kind: "models" };

interface SettingDef<T> {
  label: string;
  help: string;
  group: SettingGroup;
  scopes: readonly SettingScope[];
  /** May an org admin lock it so courses can't override it? Only for settings with course scope. */
  lockable: boolean;
  schema: z.ZodType<T>;
  default: T;
  input: Input;
}

const modelIds = AVAILABLE_MODELS.map((m) => m.id) as [string, ...string[]];
const difficulties = ["mixed", "easy", "medium", "hard"] as const;

function define<T>(def: SettingDef<T>): SettingDef<T> {
  return def;
}

export const SETTINGS = {
  "generation.allowedModels": define<string[]>({
    label: "AI models",
    help: "Which AI models can write questions in this organization.",
    group: "generation",
    scopes: ["org"],
    lockable: false,
    schema: z.array(z.enum(modelIds)).min(1, "Allow at least one model.").max(modelIds.length),
    default: [...modelIds],
    input: { kind: "models" },
  }),
  "generation.defaultDifficulty": define<(typeof difficulties)[number]>({
    label: "Default difficulty",
    help: "Pre-selected difficulty when generating a test.",
    group: "generation",
    scopes: ["org", "course"],
    lockable: false,
    schema: z.enum(difficulties),
    default: "mixed",
    input: {
      kind: "select",
      options: [
        { value: "mixed", label: "Mixed" },
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
        { value: "hard", label: "Hard" },
      ],
    },
  }),
  "generation.orgInstructions": define<string>({
    label: "Organization instructions for the AI",
    help: "Added to every generation in this organization, e.g. language, style or terminology rules.",
    group: "generation",
    scopes: ["org"],
    lockable: false,
    schema: z.string().trim().max(2_000),
    default: "",
    input: { kind: "text", maxLength: 2_000, placeholder: "e.g., Write every question in Spanish." },
  }),
  "generation.courseInstructions": define<string>({
    label: "Course instructions for the AI",
    help: "Added to every generation in this course, after the organization's instructions.",
    group: "generation",
    scopes: ["course"],
    lockable: false,
    schema: z.string().trim().max(2_000),
    default: "",
    input: { kind: "text", maxLength: 2_000, placeholder: "e.g., Focus on applying concepts, not definitions." },
  }),
  "questions.defaultPoints": define<number>({
    label: "Default points per question",
    help: "What new questions are worth when they're generated. You can change each question afterwards.",
    group: "questions",
    scopes: ["org", "course"],
    lockable: false,
    schema: z.number().min(0).max(100).multipleOf(0.5, "Use whole or half points."),
    default: 1,
    input: { kind: "number", min: 0, max: 100, step: 0.5 },
  }),
  "delivery.modes": define<"both" | "online" | "paper">({
    label: "How exams are given",
    help: "Whether professors can assign tests online, on paper (printed answer sheets), or both.",
    group: "assignments",
    scopes: ["org", "course"],
    lockable: true,
    schema: z.enum(["both", "online", "paper"]),
    default: "both",
    input: {
      kind: "select",
      options: [
        { value: "both", label: "Online and paper" },
        { value: "online", label: "Online only" },
        { value: "paper", label: "Paper only" },
      ],
    },
  }),
  "assignments.defaultTimeLimit": define<number>({
    label: "Default time limit (minutes)",
    help: "Pre-filled when you assign a test online. 0 means no time limit.",
    group: "assignments",
    scopes: ["org", "course"],
    lockable: false,
    schema: z.number().int("Use whole minutes.").min(0).max(600),
    default: 0,
    input: { kind: "number", min: 0, max: 600, step: 1 },
  }),
  "assignments.resultsRelease": define<"immediately" | "after_close" | "manual">({
    label: "When students see their results",
    help: "Pre-filled when you assign a test online.",
    group: "assignments",
    scopes: ["org", "course"],
    lockable: true,
    schema: z.enum(["immediately", "after_close", "manual"]),
    default: "after_close",
    input: {
      kind: "select",
      options: [
        { value: "immediately", label: "Right after they submit" },
        { value: "after_close", label: "When the assignment closes" },
        { value: "manual", label: "When I release them" },
      ],
    },
  }),
  "assignments.showCorrectAnswers": define<boolean>({
    label: "Show correct answers with results",
    help: "Students also see the right answers and explanations, not just their score.",
    group: "assignments",
    scopes: ["org", "course"],
    lockable: true,
    schema: z.boolean(),
    default: true,
    input: { kind: "boolean" },
  }),
  "courses.instructorsCanCreate": define<boolean>({
    label: "Instructors can create courses",
    help: "When off, only owners and admins can create courses.",
    group: "courses",
    scopes: ["org"],
    lockable: false,
    schema: z.boolean(),
    default: true,
    input: { kind: "boolean" },
  }),
  "assistants.canEdit": define<boolean>({
    label: "Assistants can edit tests",
    help: "When off, course assistants can view tests but not change them.",
    group: "courses",
    scopes: ["org", "course"],
    lockable: true,
    schema: z.boolean(),
    default: false,
    input: { kind: "boolean" },
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const GROUP_LABELS: Record<SettingGroup, string> = {
  generation: "Question generation",
  questions: "Questions",
  assignments: "Exams",
  courses: "Courses and staff",
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}
