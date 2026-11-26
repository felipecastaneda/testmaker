export type QuestionType = "multiple_choice" | "true_false";
export type Difficulty = "easy" | "medium" | "hard";
export type DifficultySetting = Difficulty | "mixed";

export interface QuestionData {
  id: string;
  question: string;
  correctAnswer: string;
  distractors: string[];
  /** Missing on tests created before question types existed; treated as multiple choice. */
  type?: QuestionType;
  difficulty?: Difficulty;
  /** Why the correct answer is right. */
  explanation?: string;
  /** Verbatim passage from the source document that supports the answer. */
  sourceQuote?: string;
  imageUrl?: string;
  sourceModel?: string;
  /** Points this question is worth. Missing means 1. */
  points?: number;
  /** Lower-case topic tags, e.g. ["photosynthesis", "cell structure"]. */
  tags?: string[];
}

export type SaveMode = "new_version" | "append" | "recreate";

export interface TestSummary {
  id: string;
  courseId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
}

export interface StoredTest {
  id: string;
  courseId: string;
  name: string;
  version: number;
  generatedAt: string;
  updatedAt: string;
  questions: QuestionData[];
}

export interface TestVersionSummary {
  version: number;
  archivedAt: string;
  questionCount: number;
}

export interface SaveTestOutcome {
  id: string;
  courseId: string;
  name: string;
  version: number;
  mode: "created" | "appended" | "version_bumped" | "recreated";
}

export interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  /** Set for auth failures so the client can react (e.g. prompt to sign in again). */
  code?: "unauthenticated" | "unverified" | "forbidden";
}


// ---------------------------------------------------------------------------
// Organizations and courses
// ---------------------------------------------------------------------------

/** A solo professor's workspace is a "personal" org with a single owner. */
export type OrgKind = "personal" | "institution";
export type OrgRole = "owner" | "admin" | "instructor" | "assistant";
export type CourseRole = "instructor" | "assistant";
export type CourseAccessNeed = "view" | "edit" | "manage";

export interface OrgSummary {
  id: string;
  name: string;
  kind: OrgKind;
  role: OrgRole;
}

export interface CourseSummary {
  id: string;
  orgId: string;
  name: string;
  code?: string;
  term?: string;
  archived: boolean;
  /** The personal "My tests" course, which can't be deleted. */
  isDefault: boolean;
  canEdit: boolean;
  canManage: boolean;
  /** Effective defaults for assigning a test online in this course. */
  assignmentDefaults: {
    timeLimitMinutes: number | null;
    resultsRelease: ResultsRelease;
    showCorrectAnswers: boolean;
    /** Online, paper, or both (setting `delivery.modes`). */
    deliveryModes: DeliveryModes;
  };
  /** Effective generation settings for this course. */
  generation: {
    allowedModels: string[];
    defaultDifficulty: DifficultySetting;
    hasInstructions: boolean;
  };
}

export interface CoursesOverview {
  orgs: (OrgSummary & { canCreateCourses: boolean })[];
  courses: CourseSummary[];
  /** The organization the user is working in; the library and generate form show its courses. */
  activeOrgId: string;
}

export interface CourseInput {
  name: string;
  code?: string;
  term?: string;
}

export interface SettingsOverview {
  profile: { email: string; selectedModels: string[] | null };
  orgs: (OrgSummary & { canManage: boolean; settings: { values?: Record<string, unknown>; locked?: unknown } })[];
  courses: {
    id: string;
    orgId: string;
    name: string;
    archived: boolean;
    canManage: boolean;
    settings: { values?: Record<string, unknown> };
  }[];
}

export interface MemberSummary {
  uid: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
}

export interface OrgMembersView {
  myRole: OrgRole;
  members: MemberSummary[];
  invites: { id: string; email: string; role: OrgRole; expiresAt: string }[];
}

export type InviteInfo =
  | { status: "valid"; orgName: string; role: OrgRole; email: string; emailMatches: boolean }
  | { status: "not_found" | "used" | "revoked" | "expired"; message: string };

export interface CourseStaffView {
  staff: { uid: string; email: string; role: CourseRole }[];
  /** Organization members not on the staff yet. */
  candidates: { uid: string; email: string }[];
}

// ---------------------------------------------------------------------------
// Assignments (online exams)
// ---------------------------------------------------------------------------

/** Set by the professor. Whether students can actually start also depends on the window. */
export type AssignmentStatus = "draft" | "open" | "closed";
/** What students can do right now: status combined with opensAt/closesAt. */
export type AssignmentAvailability = "draft" | "scheduled" | "open" | "closed";
export type ResultsRelease = "immediately" | "after_close" | "manual";

export interface AssignmentOptions {
  title: string;
  /** ISO times; null = no automatic opening/closing. */
  opensAt: string | null;
  closesAt: string | null;
  /** Minutes per attempt; null = no limit (the window still applies). */
  timeLimitMinutes: number | null;
  shuffleQuestions: boolean;
  resultsRelease: ResultsRelease;
  /** With results, also show correct answers and explanations. */
  showCorrectAnswers: boolean;
  /** At most this many students can start (guards against joins with made-up IDs). */
  maxStudents: number;
}

export type Delivery = "online" | "paper";
/** Which delivery modes a course allows (setting `delivery.modes`). */
export type DeliveryModes = "both" | "online" | "paper";
export type PaperIdCharset = "letters_digits" | "digits";

export interface PaperOptions {
  /** Printed versions A, B, … (1–4). */
  versions: number;
  /** Student-ID columns on the answer sheet (4–12). */
  idLength: number;
  idCharset: PaperIdCharset;
}

export interface AssignmentSummary extends AssignmentOptions {
  id: string;
  delivery: Delivery;
  /** Only for paper assignments. */
  paper: PaperOptions | null;
  orgId: string;
  courseId: string;
  testId: string;
  testVersion: number;
  status: AssignmentStatus;
  availability: AssignmentAvailability;
  joinCode: string;
  questionCount: number;
  totalPoints: number;
  stats: { started: number; submitted: number };
  resultsReleased: boolean;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}
