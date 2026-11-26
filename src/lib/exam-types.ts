import type { StudentResult } from "./grading";
import type { StudentQuestion } from "./student-view";
import type { StudentIdentity } from "./student-identity";
import type { AssignmentAvailability } from "./types";

/** What anyone with the join code may see before joining. */
export interface PublicAssignmentInfo {
  title: string;
  questionCount: number;
  totalPoints: number;
  timeLimitMinutes: number | null;
  availability: AssignmentAvailability;
  opensAt: string | null;
  closesAt: string | null;
  /** How students identify themselves for this exam. */
  identity: StudentIdentity;
  /** With sign-in: also ask for the student ID. */
  askStudentId: boolean;
  /** With sign-in: accepted email domains (empty = any account). */
  allowedDomains: string[];
}

/** Everything a student's browser gets about their own attempt. Never the answer key. */
export interface StudentExamView {
  title: string;
  studentName: string;
  status: "in_progress" | "submitted";
  /** ISO; null = no deadline. */
  deadline: string | null;
  /** Server time, so the countdown doesn't depend on the student's clock. */
  serverNow: string;
  questions: StudentQuestion[];
  answers: Record<string, string>;
  totalPoints: number;
  submittedAt?: string;
  submittedBy?: "student" | "deadline" | "teacher";
  result?: StudentResult;
}

export interface JoinResult {
  /** Secret key for this attempt; the browser keeps it to resume. */
  token: string;
  view: StudentExamView;
}
