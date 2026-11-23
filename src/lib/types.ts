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

