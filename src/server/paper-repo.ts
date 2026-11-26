import "server-only";
import { getAccessible, requireEditable } from "./assignments-repo";
import { deleteScan, MAX_SCAN_BYTES, readScan, saveScan } from "./scans-store";
import { attemptIdFor, readQuestions } from "./attempts-repo";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { cleanName, gradeAttempt, studentKeyOf } from "@/lib/grading";
import type { DocumentReference } from "firebase-admin/firestore";
import {
  lettersToAnswers,
  MAX_CLASS_LIST,
  normalizePaperId,
  paperVariants,
  versionLabels,
  type ClassListEntry,
  type PaperExam,
  type PaperLetters,
} from "@/lib/paper";
import type { PaperOptions, QuestionData } from "@/lib/types";

/*
 * Paper assignments: everything the professor needs to print them, and saving the answers they
 * type or scan as ordinary attempts. A paper attempt looks like an online one
 * (answers = question id → option text, graded the same way) plus
 *   source: "paper", variant: "A".."D", entry: "typed" | "scan", letters: [index | null, ...]
 *   scan?: { path, width, height, corners }   (the sheet image, in Cloud Storage; see scans-store)
 * The bubbles are read in the professor's browser (src/lib/omr.ts); the server re-checks and grades.
 */

const ATTEMPTS = "attempts";
const NOT_PAPER = "This isn't a paper exam.";

/** assignments/{id}/meta/classList = { entries: [{ id, name }], updatedAt }: optional, paper exams only. */
const classListRef = (assignment: DocumentReference) => assignment.collection("meta").doc("classList");

export async function readClassList(assignment: DocumentReference): Promise<ClassListEntry[]> {
  return ((await classListRef(assignment).get()).get("entries") as ClassListEntry[] | undefined) ?? [];
}

/** Replace the class list (an empty list removes it). Returns the stored entries. */
export async function setClassList(user: AuthedUser, id: string, entries: ClassListEntry[]): Promise<ClassListEntry[]> {
  const { ref, snap } = await requireEditable(user, id);
  const paper = paperOf(snap.data());
  if (!paper) throw new UserFacingError(NOT_PAPER);
  if (entries.length > MAX_CLASS_LIST) throw new UserFacingError(`A class list can have at most ${MAX_CLASS_LIST} students.`);
  const clean: ClassListEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const n = normalizePaperId(e.id, paper);
    if ("error" in n) throw new UserFacingError(`${e.id}: ${n.error}`);
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    clean.push({ id: n.id, name: cleanName(e.name).slice(0, 120) });
  }
  if (clean.length === 0) await classListRef(ref).delete();
  else await classListRef(ref).set({ entries: clean, updatedAt: new Date().toISOString(), updatedBy: user.uid });
  return clean;
}

function paperOf(d: FirebaseFirestore.DocumentData | undefined): (PaperOptions & { seed: string }) | null {
  return d?.delivery === "paper" && d.paper ? d.paper : null;
}

/** What printing needs: questions with the key, and the version seed. */
export async function getPaperExam(user: AuthedUser, id: string): Promise<PaperExam> {
  const { ref, snap } = await getAccessible(user, id);
  const paper = paperOf(snap.data());
  if (!paper) throw new UserFacingError(NOT_PAPER);
  const questions: PaperExam["questions"] = [...(await readQuestions(ref)).values()].map((stored) => {
    // Keep `accepted` (regrades) so score previews match the server's grading.
    const q: QuestionData & { position?: number } = { ...stored };
    delete q.position;
    return q;
  });
  return {
    title: snap.get("title"),
    paper: { versions: paper.versions, idLength: paper.idLength, idCharset: paper.idCharset },
    seed: paper.seed,
    questions,
    classList: await readClassList(ref),
  };
}

export interface PaperAnswersInput {
  studentId: string;
  studentName: string;
  variant: string;
  /** One entry per question on the sheet: option index or null (blank). */
  letters: PaperLetters;
  /** Overwrite an existing attempt for this student ID. */
  replace: boolean;
}

export type SavePaperResult =
  | { saved: true; attemptId: string; earned: number; possible: number }
  | { saved: false; existing: { studentName: string; studentId: string } };

/** A scanned sheet stored with the attempt (the image, and where its corners were found). */
export interface ScanUpload {
  /** JPEG bytes. */
  image: Buffer;
  width: number;
  height: number;
  corners: { x: number; y: number }[];
}


/** Grade one student's sheet and store it as their attempt (with the scanned image, if any). */
export async function savePaperAnswers(
  user: AuthedUser,
  id: string,
  input: PaperAnswersInput,
  scan: ScanUpload | null = null
): Promise<SavePaperResult> {
  const entry = scan ? "scan" : "typed";
  const { ref, snap } = await requireEditable(user, id);
  const paper = paperOf(snap.data());
  if (!paper) throw new UserFacingError(NOT_PAPER);

  const normalized = normalizePaperId(input.studentId, paper);
  if ("error" in normalized) throw new UserFacingError(normalized.error);
  const versionIndex = versionLabels(paper.versions).indexOf(input.variant);
  if (versionIndex < 0) throw new UserFacingError(`This exam has versions ${versionLabels(paper.versions).join(", ")}.`);

  const stored = [...(await readQuestions(ref)).values()];
  const variant = paperVariants(stored, paper.versions, paper.seed)[versionIndex];
  if (input.letters.length !== variant.questions.length) throw new UserFacingError("The answers don't match this exam's questions.");
  input.letters.forEach((l, i) => {
    if (l !== null && !(Number.isInteger(l) && l >= 0 && l < variant.questions[i].options.length)) {
      throw new UserFacingError(`Question ${i + 1} has no option ${l}.`);
    }
  });

  const studentId = normalized.id;
  const attemptRef = ref.collection(ATTEMPTS).doc(attemptIdFor(ref.id, studentKeyOf(studentId)));
  const existing = await attemptRef.get();
  if (existing.exists && !input.replace) {
    return { saved: false, existing: { studentName: existing.get("studentName") ?? "", studentId: existing.get("studentId") ?? studentId } };
  }

  const answers = lettersToAnswers(variant, input.letters);
  const grade = gradeAttempt(stored, answers);
  const now = new Date().toISOString();
  // Keep a name typed earlier when this entry has none (e.g. a re-entry by ID only).
  const studentName =
    cleanName(input.studentName).slice(0, 120) ||
    (existing.get("studentName") as string | undefined) ||
    (await readClassList(ref)).find((e) => e.id === studentId)?.name ||
    "";

  let scanInfo: Record<string, unknown> | null = null;
  if (scan) {
    const isJpeg = scan.image.length > 3 && scan.image[0] === 0xff && scan.image[1] === 0xd8 && scan.image[2] === 0xff;
    if (!isJpeg || scan.image.length > MAX_SCAN_BYTES) throw new UserFacingError("The scanned image must be a JPEG under 2 MB.");
    const path = await saveScan(ref.id, attemptRef.id, scan.image);
    scanInfo = { path, width: scan.width, height: scan.height, corners: scan.corners.slice(0, 4) };
  } else if (existing.get("scan")) {
    // Typed over a scanned entry: the old image no longer matches the answers.
    await deleteScan(ref.id, attemptRef.id);
  }

  await attemptRef.set({
    ...(scanInfo ? { scan: scanInfo } : {}),
    source: "paper",
    entry,
    variant: input.variant,
    letters: input.letters,
    studentName,
    studentId,
    studentKey: studentKeyOf(studentId),
    startedAt: now,
    submittedAt: now,
    submittedBy: "teacher",
    deadline: null,
    answers,
    grade,
    focusLosses: 0,
    enteredBy: user.uid,
    updatedAt: now,
  });
  return { saved: true, attemptId: attemptRef.id, earned: grade.earned, possible: grade.possible };
}

export interface PaperScanView {
  /** data:image/jpeg;base64,… (served through the server; Storage stays closed to browsers). */
  dataUrl: string;
  width: number;
  height: number;
  corners: { x: number; y: number }[];
  variant: string;
  letters: PaperLetters;
  /** To draw the sheet layout over the image. */
  paper: Pick<PaperOptions, "idLength" | "idCharset">;
  optionCounts: number[];
}

/** The stored scan of one paper attempt, for the professor to look at. */
export async function getPaperScan(user: AuthedUser, id: string, attemptId: string): Promise<PaperScanView> {
  const { ref, snap } = await getAccessible(user, id);
  const paper = paperOf(snap.data());
  if (!paper) throw new UserFacingError(NOT_PAPER);
  const attempt = await ref.collection(ATTEMPTS).doc(attemptId).get();
  const scan = attempt.get("scan") as { path: string; width: number; height: number; corners: { x: number; y: number }[] } | undefined;
  if (!attempt.exists || !scan) throw new UserFacingError("There's no scanned sheet for this student.");
  const [bytes, questions] = await Promise.all([readScan(scan.path), readQuestions(ref)]);
  const versionIndex = Math.max(0, versionLabels(paper.versions).indexOf(attempt.get("variant")));
  const variant = paperVariants([...questions.values()], paper.versions, paper.seed)[versionIndex];
  return {
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    width: scan.width,
    height: scan.height,
    corners: scan.corners,
    variant: attempt.get("variant"),
    letters: attempt.get("letters") ?? [],
    paper: { idLength: paper.idLength, idCharset: paper.idCharset },
    optionCounts: variant.questions.map((q) => q.options.length),
  };
}
