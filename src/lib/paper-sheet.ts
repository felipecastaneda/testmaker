import { escapeHtml } from "./exporters";
import { ID_CHARSETS } from "./paper";
import { optionLetter } from "./question-utils";
import type { PaperOptions } from "./types";

/**
 * The answer sheet's geometry, in millimetres from the sheet's top-left corner. Printing draws
 * it; the scanner (step 3, part 2) reads the same positions after locating the corner markers,
 * so the two can never disagree. Changing any number here makes printed sheets unreadable:
 * bump SHEET_LAYOUT_VERSION if it ever has to change.
 *
 * 190 × 255 mm fits inside both Letter and A4 with at least 10 mm margins.
 */

export const SHEET_LAYOUT_VERSION = 1;
export const SHEET = { width: 190, height: 255 } as const;
export const MARKER_SIZE = 7;
export const BUBBLE_RADIUS = 1.8;
export const CODE_BITS = 24;

export interface Circle {
  cx: number;
  cy: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  markers: Rect[];
  codeCells: Rect[];
  idBoxes: Rect[];
  /** idBubbles[column][row], row = index in the ID charset. */
  idBubbles: Circle[][];
  idChars: string;
  /** answerBubbles[question][option]. */
  answerBubbles: Circle[][];
  /** Where each question number is printed (right-aligned). */
  questionLabels: Circle[];
}

interface AnswerGrid {
  x: number;
  y: number;
  columns: number;
  rows: number;
  columnWidth: number;
  rowPitch: number;
}

const ID_X = 8;
const ID_BOX_Y = 31;
const ID_BUBBLE_Y = 41;
const ID_PITCH_X = 5;
const ID_PITCH_Y = 5.5;
const OPTION_PITCH = 5.5;

function answerGrid(charset: PaperOptions["idCharset"]): AnswerGrid {
  return charset === "digits"
    ? { x: 8, y: 102, columns: 4, rows: 25, columnWidth: 44, rowPitch: 5.6 }
    : { x: 78, y: 33, columns: 3, rows: 25, columnWidth: 36, rowPitch: 8.4 };
}

/** `optionCounts[i]` = number of options of question i on this version (2–5). */
export function sheetLayout(paper: Pick<PaperOptions, "idLength" | "idCharset">, optionCounts: number[]): SheetLayout {
  const m = MARKER_SIZE;
  const markers = [
    { x: 0, y: 0, w: m, h: m },
    { x: SHEET.width - m, y: 0, w: m, h: m },
    { x: 0, y: SHEET.height - m, w: m, h: m },
    { x: SHEET.width - m, y: SHEET.height - m, w: m, h: m },
  ];
  const codeCells = Array.from({ length: CODE_BITS }, (_, i) => ({ x: 20 + i * 4, y: SHEET.height - 6, w: 4, h: 5 }));

  const idChars = ID_CHARSETS[paper.idCharset];
  const columnX = (c: number) => ID_X + 5 + c * ID_PITCH_X;
  const idBoxes = Array.from({ length: paper.idLength }, (_, c) => ({ x: columnX(c) - 2.3, y: ID_BOX_Y, w: 4.6, h: 6 }));
  const idBubbles = Array.from({ length: paper.idLength }, (_, c) =>
    [...idChars].map((_, r) => ({ cx: columnX(c), cy: ID_BUBBLE_Y + r * ID_PITCH_Y }))
  );

  const grid = answerGrid(paper.idCharset);
  const place = (q: number) => {
    const col = Math.floor(q / grid.rows);
    const row = q % grid.rows;
    return { x: grid.x + col * grid.columnWidth, y: grid.y + row * grid.rowPitch };
  };
  const answerBubbles = optionCounts.map((count, q) => {
    const { x, y } = place(q);
    return Array.from({ length: count }, (_, o) => ({ cx: x + 9 + o * OPTION_PITCH, cy: y }));
  });
  const questionLabels = optionCounts.map((_, q) => {
    const { x, y } = place(q);
    return { cx: x + 5.5, cy: y };
  });
  return { markers, codeCells, idBoxes, idBubbles, idChars, answerBubbles, questionLabels };
}

/** FNV-1a, 32-bit. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The code strip: [1][version: 2 bits][assignment check: 18 bits][parity: 2 bits][1].
 * The scanner uses it to reject sheets from another exam and to know the version.
 */
export function sheetCodeBits(assignmentId: string, versionIndex: number): number[] {
  const check = hash(`${assignmentId}:v${SHEET_LAYOUT_VERSION}`) & 0x3ffff;
  const data = [...Array.from({ length: 2 }, (_, i) => (versionIndex >> (1 - i)) & 1), ...Array.from({ length: 18 }, (_, i) => (check >> (17 - i)) & 1)];
  const parity = (bits: number[]) => bits.reduce((a, b) => a ^ b, 0);
  return [1, ...data, parity(data.filter((_, i) => i % 2 === 0)), parity(data.filter((_, i) => i % 2 === 1)), 1];
}

/** Read the strip back: the version, or null if it doesn't belong to this assignment. */
export function decodeSheetCode(bits: number[], assignmentId: string, versions: number): number | null {
  if (bits.length !== CODE_BITS) return null;
  for (let v = 0; v < versions; v++) {
    const expected = sheetCodeBits(assignmentId, v);
    if (expected.every((b, i) => b === bits[i])) return v;
  }
  return null;
}

const f = (n: number) => String(Math.round(n * 100) / 100);

export interface SheetText {
  title: string;
  subtitle: string;
  versionLabel: string;
  /** Show the version on the sheet (hidden when there's only one). */
  showVersion: boolean;
}

/** One answer sheet as an SVG drawn at real size (mm). */
export function answerSheetSvg(
  text: SheetText,
  paper: Pick<PaperOptions, "idLength" | "idCharset">,
  optionCounts: number[],
  codeBits: number[]
): string {
  const L = sheetLayout(paper, optionCounts);
  const parts: string[] = [];
  const rect = (r: Rect, fill = "#000") => `<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" fill="${fill}"/>`;
  const bubble = (c: Circle, label: string) =>
    `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${BUBBLE_RADIUS}" fill="none" stroke="#111" stroke-width="0.25"/>` +
    `<text x="${f(c.cx)}" y="${f(c.cy + 0.8)}" font-size="2.2" text-anchor="middle" fill="#9ca3af">${label}</text>`;

  parts.push(...L.markers.map((m) => rect(m)));
  parts.push(...L.codeCells.map((c, i) => (codeBits[i] ? rect(c) : "")));

  // Header
  parts.push(`<text x="11" y="5.5" font-size="4.2" font-weight="700">${escapeHtml(text.title.slice(0, 70))}</text>`);
  if (text.subtitle) parts.push(`<text x="11" y="10" font-size="2.8" fill="#475569">${escapeHtml(text.subtitle.slice(0, 100))}</text>`);
  if (text.showVersion) {
    parts.push(`<text x="${SHEET.width - 10}" y="8" font-size="6" font-weight="700" text-anchor="end" data-version="${text.versionLabel}">Version ${text.versionLabel}</text>`);
  }
  parts.push(`<text x="11" y="18" font-size="3.4">Name</text><line x1="21" y1="18.5" x2="120" y2="18.5" stroke="#111" stroke-width="0.25"/>`);
  parts.push(
    `<text x="11" y="24" font-size="2.6" fill="#334155">Use a dark pen or pencil. Fill each circle completely, one per question. Erase or white-out mistakes fully.</text>`
  );

  // Student ID
  parts.push(`<text x="${ID_X}" y="29" font-size="2.8" font-weight="700">STUDENT ID</text>`);
  parts.push(
    ...L.idBoxes.map((b) => `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" fill="none" stroke="#111" stroke-width="0.25"/>`)
  );
  [...L.idChars].forEach((ch, r) => {
    const y = L.idBubbles[0]?.[r]?.cy ?? 0;
    parts.push(`<text x="${ID_X + 1}" y="${f(y + 0.9)}" font-size="2.4" text-anchor="middle" fill="#475569">${ch}</text>`);
  });
  L.idBubbles.forEach((column) => column.forEach((c, r) => parts.push(bubble(c, L.idChars[r]))));

  // Answers
  L.answerBubbles.forEach((options, q) => {
    const label = L.questionLabels[q];
    parts.push(`<text x="${f(label.cx)}" y="${f(label.cy + 1)}" font-size="2.8" font-weight="700" text-anchor="end">${q + 1}</text>`);
    options.forEach((c, o) => parts.push(bubble(c, optionLetter(o))));
  });

  parts.push(`<text x="${f(20 + CODE_BITS * 4 + 3)}" y="${SHEET.height - 2}" font-size="2" fill="#94a3b8">Don't write in the corners or on this strip.</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" class="sheet" width="${SHEET.width}mm" height="${SHEET.height}mm" viewBox="0 0 ${SHEET.width} ${SHEET.height}" font-family="Arial, Helvetica, sans-serif">${parts.join("")}</svg>`;
}
