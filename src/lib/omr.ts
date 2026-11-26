import { CODE_BITS, decodeSheetCode, MARKER_SIZE, SHEET, sheetLayout, type Circle, type Rect } from "./paper-sheet";
import type { PaperOptions } from "./types";

/**
 * Reads a photographed or scanned answer sheet (optical mark recognition), in plain TypeScript.
 *
 * 1. Find the four solid corner squares (dark, filled, square blobs that don't touch the image edge).
 * 2. Map sheet millimetres to image pixels with the homography through their centres, so tilted
 *    photos and scanner skew don't matter. The code strip tells which of the four rotations is
 *    right (upside-down and sideways photos work) and which version the sheet is.
 * 3. Measure how dark each bubble is relative to this sheet's own paper and ink, and compare each
 *    bubble with the others on the sheet. Anything doubtful is flagged for the professor.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black, 255 = white. */
  data: Uint8Array | Uint8ClampedArray;
}

export interface Point {
  x: number;
  y: number;
}

export type MarkFlag = "multiple" | "faint" | "unclear";

export interface MarkRead {
  /** Chosen option (or ID character) index, or null for blank / undecidable. */
  value: number | null;
  flag: MarkFlag | null;
  /** Darkness above the sheet's empty-bubble level, per option (for display). */
  levels: number[];
}

export interface SheetRead {
  /** Image positions of the corner-square centres: top-left, top-right, bottom-right, bottom-left of the sheet. */
  corners: [Point, Point, Point, Point];
  /** Version index from the code strip, or null if the strip isn't this assignment's. */
  version: number | null;
  /** One per ID column. */
  id: MarkRead[];
  /** One per question of the version read (or of version A when the version is unknown). */
  answers: MarkRead[];
}

export type ReadResult = { ok: true; sheet: SheetRead } | { ok: false; error: string };

export interface ReadOptions {
  assignmentId: string;
  paper: Pick<PaperOptions, "idLength" | "idCharset" | "versions">;
  /** optionCounts[version][question]. */
  optionCounts: number[][];
}

/** Darkness above the empty-bubble level that counts as a filled bubble / a possible mark. */
const FILLED = 0.3;
const FAINT = 0.15;
/** A chosen mark must beat the runner-up by this much. */
const MARGIN = 0.2;

export const NO_CORNERS =
  "Couldn't find the four black corner squares. Retake the photo with the whole sheet flat and visible, on a plain background.";

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/** RGBA (canvas ImageData) → gray. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  }
  return { width, height, data };
}

function otsu(img: GrayImage): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++;
  const total = img.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  cx: number;
  cy: number;
  touchesEdge: boolean;
}

/**
 * Ink mask: pixels clearly darker than their neighbourhood (and darker than `ceiling`).
 * Local, so uneven light and dark desks don't matter.
 */
function inkMask(img: GrayImage, ceiling: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) * 0.035));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const g = data[y * w + x];
      mask[y * w + x] = g < mean * 0.65 && g < ceiling ? 1 : 0;
    }
  }
  return mask;
}

/** Connected regions of the mask (4-connected). */
function darkBlobs(img: GrayImage, mask: Uint8Array): Blob[] {
  const { width: w, height: h } = img;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: Blob[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !mask[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0, sx = 0, sy = 0;
    while (top) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !seen[p - 1] && mask[p - 1]) {
        seen[p - 1] = 1;
        stack[top++] = p - 1;
      }
      if (x < w - 1 && !seen[p + 1] && mask[p + 1]) {
        seen[p + 1] = 1;
        stack[top++] = p + 1;
      }
      if (y > 0 && !seen[p - w] && mask[p - w]) {
        seen[p - w] = 1;
        stack[top++] = p - w;
      }
      if (y < h - 1 && !seen[p + w] && mask[p + w]) {
        seen[p + w] = 1;
        stack[top++] = p + w;
      }
    }
    if (area < 9) continue;
    blobs.push({ minX, minY, maxX, maxY, area, cx: sx / area, cy: sy / area, touchesEdge: minX === 0 || minY === 0 || maxX === w - 1 || maxY === h - 1 });
  }
  return blobs;
}

function bilinear(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Centres of the corner squares in sheet millimetres: TL, TR, BR, BL. */
const h = MARKER_SIZE / 2;
export const MARKER_CENTRES: [Point, Point, Point, Point] = [
  { x: h, y: h },
  { x: SHEET.width - h, y: h },
  { x: SHEET.width - h, y: SHEET.height - h },
  { x: h, y: SHEET.height - h },
];

export type Homography = number[];

/** The 3×3 matrix (row-major, h33 = 1) mapping each `from` point to its `to` point. */
export function homography(from: Point[], to: Point[]): Homography {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const p = A[col][col];
    if (Math.abs(p) < 1e-12) throw new Error("Degenerate corner points.");
    for (let c = col; c < 9; c++) A[col][c] /= p;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f) for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  return [...A.map((row) => row[8]), 1];
}

export function project(H: Homography, p: Point): Point {
  const d = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d };
}

/** Sheet millimetres → image pixels, given the corner-square centres found in the image. */
export const sheetToImage = (corners: Point[]) => homography(MARKER_CENTRES, corners);

/** The four corner squares' centres in image pixels, in the image's own TL, TR, BR, BL order. */
function findCorners(img: GrayImage): [Point, Point, Point, Point] | null {
  // Below the overall paper/background split (with headroom), and locally dark.
  const ceiling = Math.min(255, otsu(img) + 40);
  const short = Math.min(img.width, img.height);
  const long = Math.max(img.width, img.height);
  const candidates = darkBlobs(img, inkMask(img, ceiling)).filter((b) => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const aspect = bw / bh;
    return (
      !b.touchesEdge &&
      Math.min(bw, bh) >= short * 0.008 &&
      Math.max(bw, bh) <= long * 0.08 &&
      aspect > 0.7 &&
      aspect < 1.43 &&
      b.area / (bw * bh) >= 0.6 && // a rotated square fills half its box; circles ~0.78 but are small
      b.area / (bw * bh) <= 1.01
    );
  });
  if (candidates.length < 4) return null;
  // Corner squares are the largest of these on the sheet (code-strip cells and bubbles are smaller).
  candidates.sort((a, b) => b.area - a.area);
  const big = candidates.filter((b) => b.area >= candidates[0].area * 0.5).slice(0, 12);
  if (big.length < 4) return null;
  const pick = (score: (b: Blob) => number) => big.reduce((best, b) => (score(b) > score(best) ? b : best));
  const tl = pick((b) => -(b.cx + b.cy));
  const br = pick((b) => b.cx + b.cy);
  const tr = pick((b) => b.cx - b.cy);
  const bl = pick((b) => b.cy - b.cx);
  const quad = [tl, tr, br, bl];
  if (new Set(quad).size < 4) return null;
  // The four must look alike...
  const areas = quad.map((b) => b.area);
  if (Math.max(...areas) > Math.min(...areas) * 2.5) return null;
  // ...and be spread out like a sheet's corners: a sheet-shaped quadrilateral (portrait or
  // landscape, allowing for perspective) covering a fair part of the photo.
  const dist = (a: Blob, b: Blob) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const across = (dist(tl, tr) + dist(bl, br)) / 2;
  const down = (dist(tl, bl) + dist(tr, br)) / 2;
  const ratio = Math.min(across, down) / Math.max(across, down); // sheet: 179 / 248 ≈ 0.72
  if (ratio < 0.5 || ratio > 0.95) return null;
  if (across * down < img.width * img.height * 0.12) return null;
  // A corner square is about 7 mm of the 179 mm between the squares' centres.
  const side = Math.sqrt(areas.reduce((a, b) => a + b, 0) / 4);
  if (side < Math.min(across, down) * 0.015 || side > Math.min(across, down) * 0.09) return null;
  return quad.map((b) => ({ x: b.cx, y: b.cy })) as [Point, Point, Point, Point];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const RING: Point[] = [{ x: 0, y: 0 }];
for (const r of [0.45, 0.9, 1.25]) {
  for (let k = 0; k < 8; k++) RING.push({ x: r * Math.cos((k * Math.PI) / 4 + r), y: r * Math.sin((k * Math.PI) / 4 + r) });
}

/** Points just outside a bubble (between neighbours), to measure the paper around it. */
const SURROUND: Point[] = Array.from({ length: 12 }, (_, k) => ({ x: 2.55 * Math.cos((k * Math.PI) / 6), y: 2.55 * Math.sin((k * Math.PI) / 6) }));

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

/**
 * Samples the sheet through the homography. Darkness is measured against the paper right next
 * to each mark (photos are often lit unevenly), scaled by how dark this sheet's ink is.
 */
class Sampler {
  /** Ink brightness as a fraction of the paper next to it (from the corner squares). */
  private inkRatio = 0.1;
  constructor(
    private img: GrayImage,
    private H: Homography
  ) {}

  gray(u: number, v: number): number {
    const p = project(this.H, { x: u, y: v });
    return bilinear(this.img, p.x, p.y);
  }

  calibrate() {
    const ratios = MARKER_CENTRES.map((c) => {
      const ink = [-1.5, 0, 1.5].flatMap((dx) => [-1.5, 0, 1.5].map((dy) => this.gray(c.x + dx, c.y + dy)));
      // Paper beside the square, on the sheet side.
      const sx = c.x < SHEET.width / 2 ? 1 : -1;
      const sy = c.y < SHEET.height / 2 ? 1 : -1;
      const paper = [6, 7, 8].flatMap((d) => [this.gray(c.x + sx * d, c.y), this.gray(c.x, c.y + sy * d), this.gray(c.x + sx * d, c.y + sy * d)]);
      const mean = ink.reduce((a, b) => a + b, 0) / ink.length;
      return mean / Math.max(percentile(paper, 0.75), 1);
    });
    this.inkRatio = Math.min(0.7, Math.max(0, percentile(ratios, 0.5)));
  }

  private darkness(g: number, white: number): number {
    const range = Math.max(white * (1 - this.inkRatio), 20);
    return Math.min(1, Math.max(0, (white - g) / range));
  }

  bubble(c: Circle): number {
    const white = percentile(
      SURROUND.map((o) => this.gray(c.cx + o.x, c.cy + o.y)),
      0.75
    );
    let sum = 0;
    for (const o of RING) sum += this.darkness(this.gray(c.cx + o.x, c.cy + o.y), white);
    return sum / RING.length;
  }

  cell(r: Rect): number {
    // The code strip sits on plain paper; measure the paper just above the cell.
    const white = Math.max(this.gray(r.x + r.w / 2, r.y - 1.5), this.gray(r.x + r.w / 2, r.y - 2.5));
    let sum = 0;
    let n = 0;
    for (let du = 0.25; du < 0.8; du += 0.25) {
      for (let dv = 0.25; dv < 0.8; dv += 0.25) {
        sum += this.darkness(this.gray(r.x + r.w * du, r.y + r.h * dv), white);
        n++;
      }
    }
    return sum / n;
  }
}

/** Decide one row of bubbles (a question, or one ID column). */
export function decideRow(raw: number[], baseline: number): MarkRead {
  const levels = raw.map((v) => Math.max(0, v - baseline));
  let top = -1;
  let second = -1;
  levels.forEach((l, i) => {
    if (top < 0 || l > levels[top]) {
      second = top;
      top = i;
    } else if (second < 0 || l > levels[second]) second = i;
  });
  const t = top >= 0 ? levels[top] : 0;
  const s = second >= 0 ? levels[second] : 0;
  if (t < FAINT) return { value: null, flag: null, levels };
  if (s >= FILLED) return { value: null, flag: "multiple", levels };
  if (t < FILLED) return { value: top, flag: "faint", levels };
  if (t - s < MARGIN) return { value: top, flag: "unclear", levels };
  return { value: top, flag: null, levels };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

const ROTATIONS = [0, 1, 2, 3];
const rotate = (c: Point[], k: number) => [0, 1, 2, 3].map((i) => c[(i + k) % 4]);

/** Read one sheet image. */
export function readSheet(img: GrayImage, options: ReadOptions): ReadResult {
  const found = findCorners(img);
  if (!found) return { ok: false, error: NO_CORNERS };

  // Try the four ways the sheet could be turned; the code strip says which one is right.
  const layoutFor = (version: number) => sheetLayout(options.paper, options.optionCounts[version] ?? options.optionCounts[0]);
  const base = layoutFor(0);
  let chosen: { corners: Point[]; sampler: Sampler; version: number | null } | null = null;
  for (const k of ROTATIONS) {
    const corners = rotate(found, k);
    let H: Homography;
    try {
      H = sheetToImage(corners);
    } catch {
      continue;
    }
    const sampler = new Sampler(img, H);
    sampler.calibrate();
    const bits = base.codeCells.map((cell) => (sampler.cell(cell) > 0.5 ? 1 : 0));
    const version = decodeSheetCode(bits, options.assignmentId, options.paper.versions);
    if (version !== null) {
      chosen = { corners, sampler, version };
      break;
    }
  }
  if (!chosen) {
    // Not this exam's strip (or it's damaged): assume the photo is upright, portrait.
    const corners = found as Point[];
    const width = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const height = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
    const upright = width < height ? corners : rotate(corners, 3);
    const sampler = new Sampler(img, sheetToImage(upright));
    sampler.calibrate();
    chosen = { corners: upright, sampler, version: null };
  }

  const { sampler, version } = chosen;
  const layout = layoutFor(version ?? 0);
  const answerRaw = layout.answerBubbles.map((row) => row.map((c) => sampler.bubble(c)));
  const idRaw = layout.idBubbles.map((col) => col.map((c) => sampler.bubble(c)));
  // Most bubbles on a sheet are empty: their median is this sheet's "empty" level.
  const baseline = median([...answerRaw.flat(), ...idRaw.flat()]);

  return {
    ok: true,
    sheet: {
      corners: chosen.corners as SheetRead["corners"],
      version,
      id: idRaw.map((col) => decideRow(col, baseline)),
      answers: answerRaw.map((row) => decideRow(row, baseline)),
    },
  };
}

/** The ID as read, plus whether it needs checking (a flagged column, or a gap before the last character). */
export function idFromMarks(marks: MarkRead[], chars: string): { id: string; doubtful: boolean } {
  let id = "";
  let doubtful = false;
  let ended = false;
  for (const m of marks) {
    if (m.flag) doubtful = true;
    if (m.value === null) {
      if (m.flag === null) ended = true;
      continue;
    }
    if (ended) doubtful = true; // a blank column in the middle
    id += chars[m.value];
  }
  return { id, doubtful };
}

export const CODE_CELLS = CODE_BITS;
