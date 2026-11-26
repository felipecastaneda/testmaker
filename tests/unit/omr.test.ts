import { describe, expect, it } from "vitest";
import { decideRow, homography, idFromMarks, project, readSheet, type GrayImage, type Point } from "@/lib/omr";
import { ID_CHARSETS } from "@/lib/paper";
import { BUBBLE_RADIUS, SHEET, sheetCodeBits, sheetLayout } from "@/lib/paper-sheet";
import type { PaperOptions } from "@/lib/types";

/*
 * A tiny "camera": draws an answer sheet straight from the layout geometry onto a gray image,
 * through any perspective (tilt, rotation, upside down), with uneven light, noise and blur.
 */

type Fill = number | number[] | null; // option index(es) filled
interface SheetSpec {
  paper: Pick<PaperOptions, "idLength" | "idCharset" | "versions">;
  optionCounts: number[];
  assignmentId: string;
  version: number;
  id: string;
  answers: Fill[];
  /** Fill darkness per question (gray value); default dark pencil. */
  shade?: Record<number, number>;
}

function render(spec: SheetSpec, imageCorners: Point[], size = { width: 900, height: 1200 }, light = 0.3): GrayImage {
  const layout = sheetLayout(spec.paper, spec.optionCounts);
  const bits = sheetCodeBits(spec.assignmentId, spec.version);
  const chars = ID_CHARSETS[spec.paper.idCharset];
  const filled = new Map<string, number>(); // circle key → gray
  const key = (c: { cx: number; cy: number }) => `${c.cx.toFixed(2)},${c.cy.toFixed(2)}`;
  spec.answers.forEach((f, q) => {
    for (const o of f === null ? [] : Array.isArray(f) ? f : [f]) filled.set(key(layout.answerBubbles[q][o]), spec.shade?.[q] ?? 70);
  });
  [...spec.id].forEach((ch, col) => filled.set(key(layout.idBubbles[col][chars.indexOf(ch)]), 70));

  // Spatial index of circles in 4 mm cells.
  const grid = new Map<string, { cx: number; cy: number; fill: number | null }[]>();
  for (const c of [...layout.answerBubbles.flat(), ...layout.idBubbles.flat()]) {
    const cell = `${Math.floor(c.cx / 4)},${Math.floor(c.cy / 4)}`;
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell)!.push({ ...c, fill: filled.get(key(c)) ?? null });
  }
  const sheetCorners = [
    { x: 0, y: 0 },
    { x: SHEET.width, y: 0 },
    { x: SHEET.width, y: SHEET.height },
    { x: 0, y: SHEET.height },
  ];
  const toSheet = homography(imageCorners, sheetCorners);
  const inRect = (u: number, v: number, r: { x: number; y: number; w: number; h: number }) => u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h;

  const { width, height } = size;
  const raw = new Float32Array(width * height);
  let seed = 12345;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 16;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { x: u, y: v } = project(toSheet, { x: x + 0.5, y: y + 0.5 });
      let g: number;
      if (u < -12 || v < -12 || u > SHEET.width + 12 || v > SHEET.height + 12) g = 95; // desk
      else {
        g = 238;
        if (layout.markers.some((m) => inRect(u, v, m))) g = 25;
        else if (layout.codeCells.some((c, i) => bits[i] && inRect(u, v, c))) g = 25;
        else {
          for (const c of grid.get(`${Math.floor(u / 4)},${Math.floor(v / 4)}`) ?? []) {
            const d = Math.hypot(u - c.cx, v - c.cy);
            if (c.fill !== null && d <= BUBBLE_RADIUS + 0.1) g = Math.min(g, c.fill);
            else if (Math.abs(d - BUBBLE_RADIUS) <= 0.13) g = Math.min(g, 80);
          }
        }
      }
      const lighting = 1 - light + light * (x / width); // darker on the left
      raw[y * width + x] = g * lighting + noise();
    }
  }
  // 3×3 box blur (camera softness).
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height) {
          s += raw[yy * width + xx];
          n++;
        }
      }
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(s / n)));
    }
  }
  return { width, height, data };
}

const paper = { idLength: 6, idCharset: "letters_digits" as const, versions: 2 };
const counts = [4, 4, 2, 4, 5, 4, 4, 4, 3, 4];
const base: SheetSpec = {
  paper,
  optionCounts: counts,
  assignmentId: "assign-1",
  version: 1,
  id: "AB12",
  answers: [0, 1, 1, 3, 4, 2, null, 0, 2, 1],
};
const options = { assignmentId: "assign-1", paper, optionCounts: [counts, counts] };

// Where the sheet's corners land in the photo.
const upright = [
  { x: 60, y: 50 },
  { x: 840, y: 50 },
  { x: 840, y: 1097 },
  { x: 60, y: 1097 },
];
const tilted = [
  { x: 120, y: 90 },
  { x: 820, y: 30 },
  { x: 870, y: 1110 },
  { x: 40, y: 1150 },
];
const turn = (pts: Point[], k: number) => pts.map((_, i) => pts[(i + k) % 4]);

function expectRead(img: GrayImage, spec = base) {
  const result = readSheet(img, options);
  if (!result.ok) throw new Error(result.error);
  const { sheet } = result;
  expect(sheet.version).toBe(spec.version);
  expect(sheet.answers.map((a) => a.value)).toEqual(spec.answers.map((a) => (Array.isArray(a) ? null : a)));
  expect(idFromMarks(sheet.id, ID_CHARSETS.letters_digits)).toEqual({ id: spec.id, doubtful: false });
  return sheet;
}

describe("reading answer sheets", () => {
  it("reads an upright scan", () => {
    const sheet = expectRead(render(base, upright));
    expect(sheet.answers.every((a) => a.flag === null)).toBe(true);
  });

  it("reads a tilted photo with uneven light", () => {
    expectRead(render(base, tilted, undefined, 0.45));
  });

  it("reads upside-down and sideways photos", () => {
    expectRead(render(base, turn(upright, 2)));
    const landscape = [
      { x: 1140, y: 60 },
      { x: 1140, y: 840 },
      { x: 60, y: 840 },
      { x: 60, y: 60 },
    ];
    expectRead(render(base, landscape, { width: 1200, height: 900 }));
    expectRead(render(base, turn(landscape, 2), { width: 1200, height: 900 }));
  });

  it("flags two marks and faint marks instead of guessing", () => {
    const spec: SheetSpec = { ...base, answers: [[0, 2], 1, 1, 3, 4, 2, null, 0, 2, 1], shade: { 1: 175 } };
    const result = readSheet(render(spec, upright), options);
    if (!result.ok) throw new Error(result.error);
    expect(result.sheet.answers[0]).toMatchObject({ value: null, flag: "multiple" });
    expect(result.sheet.answers[1]).toMatchObject({ value: 1, flag: "faint" });
    expect(result.sheet.answers[6]).toMatchObject({ value: null, flag: null });
  });

  it("doesn't recognise a sheet from another exam", () => {
    const result = readSheet(render({ ...base, assignmentId: "other" }, upright), options);
    if (!result.ok) throw new Error(result.error);
    expect(result.sheet.version).toBeNull();
    // It still reads the marks, so the professor can choose the version by hand.
    expect(result.sheet.answers[0].value).toBe(0);
  });

  it("doesn't mistake filled bubbles in a close-up for corner squares", () => {
    const full = render(base, upright);
    // Crop the student-ID area (filled bubbles, no corner squares).
    const x0 = 60, y0 = 160, w = 300, h = 400;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = full.data[(y0 + y) * full.width + x0 + x];
    expect(readSheet({ width: w, height: h, data }, options)).toMatchObject({ ok: false });
  });

  it("explains when there's no sheet in the photo", () => {
    const blank: GrayImage = { width: 300, height: 400, data: new Uint8Array(300 * 400).fill(200) };
    expect(readSheet(blank, options)).toMatchObject({ ok: false });
  });
});

describe("deciding marks", () => {
  it("picks a clear mark, ignores an erased one, flags ties", () => {
    expect(decideRow([0.05, 0.8, 0.06, 0.05], 0.05)).toMatchObject({ value: 1, flag: null });
    expect(decideRow([0.05, 0.8, 0.25, 0.05], 0.05)).toMatchObject({ value: 1, flag: null }); // erased C
    expect(decideRow([0.05, 0.6, 0.5, 0.05], 0.05)).toMatchObject({ value: null, flag: "multiple" });
    expect(decideRow([0.05, 0.3, 0.05, 0.05], 0.05)).toMatchObject({ value: 1, flag: "faint" });
    expect(decideRow([0.05, 0.06, 0.05, 0.05], 0.05)).toMatchObject({ value: null, flag: null });
  });

  it("reads IDs and flags gaps", () => {
    const m = (value: number | null, flag: null | "faint" = null) => ({ value, flag, levels: [] });
    expect(idFromMarks([m(0), m(27), m(null), m(null)], ID_CHARSETS.letters_digits)).toEqual({ id: "A1", doubtful: false });
    expect(idFromMarks([m(0), m(null), m(27)], ID_CHARSETS.letters_digits)).toEqual({ id: "A1", doubtful: true });
    expect(idFromMarks([m(0), m(27, "faint")], ID_CHARSETS.letters_digits)).toEqual({ id: "A1", doubtful: true });
  });
});
