export interface QuestionData {
  id: string;
  question: string;
  correctAnswer: string;
  distractors: string[];
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

export interface ActionResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}
