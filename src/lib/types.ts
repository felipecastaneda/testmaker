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
