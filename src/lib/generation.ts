import type { QuestionData } from "./types";

/** Max characters sent to the model per request (~10k tokens). */
export const MAX_CHUNK_CHARS = 40_000;
/** Max questions requested from the model in one call. */
export const MAX_QUESTIONS_PER_BATCH = 15;
/** Upper bound on total document size accepted for one generation run. */
export const MAX_DOCUMENT_CHARS = 400_000;

/**
 * Split a document into chunks of at most `maxChars`, preferring paragraph, then
 * line, then sentence boundaries so a chunk rarely cuts an idea in half.
 */
export function chunkDocument(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];

  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const minCut = Math.floor(maxChars * 0.5);
    let cut = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const idx = window.lastIndexOf(sep);
      if (idx >= minCut) {
        cut = idx + sep.length;
        break;
      }
    }
    if (cut === -1) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** Split `total` across `weights` proportionally (largest-remainder method). */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const result = exact.map(Math.floor);
  let remaining = total - result.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remaining > 0; k = (k + 1) % order.length, remaining--) {
    result[order[k].i]++;
  }
  return result;
}

export interface GenerationBatch {
  chunkIndex: number;
  model: string;
  count: number;
}

/**
 * Plan the generation requests: questions are spread over chunks in proportion to
 * their length, each chunk's share is split across the selected models, and any
 * share bigger than `maxPerBatch` is split into several requests.
 */
export function planBatches(
  chunks: string[],
  models: string[],
  total: number,
  maxPerBatch = MAX_QUESTIONS_PER_BATCH
): GenerationBatch[] {
  if (chunks.length === 0 || models.length === 0 || total <= 0) return [];
  const perChunk = apportion(
    total,
    chunks.map((c) => c.length)
  );

  const batches: GenerationBatch[] = [];
  let rotation = 0;
  perChunk.forEach((chunkTotal, chunkIndex) => {
    if (chunkTotal === 0) return;
    // Rotate which model gets the remainder so no model is systematically favoured.
    const rotated = models.map((_, i) => models[(i + rotation) % models.length]);
    rotation++;
    apportion(
      chunkTotal,
      rotated.map(() => 1)
    ).forEach((modelTotal, i) => {
      for (let left = modelTotal; left > 0; left -= maxPerBatch) {
        batches.push({ chunkIndex, model: rotated[i], count: Math.min(maxPerBatch, left) });
      }
    });
  });
  return batches;
}

/** Question words and fillers that say nothing about what is being asked. */
const STOPWORDS = new Set(
  "a an the of in on at to for by with from and or is are was were be been being do does did what which who whom whose when where why how this that these those it its into as called named known following".split(
    " "
  )
);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

function normalizeAnswer(text: string): string {
  return normalizeText(text).replace(/^(the|a|an) /, "");
}

function overlap(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return {
    jaccard: union === 0 ? 1 : shared / union,
    /** Shared words relative to the shorter question: catches "X?" vs "Which thing is X?". */
    containment: Math.min(a.size, b.size) === 0 ? 0 : shared / Math.min(a.size, b.size),
  };
}

/**
 * Remove near-duplicate questions (different models often ask the same thing).
 * Two questions are duplicates when their content words overlap heavily, or when
 * one mostly contains the other *and* they share the same correct answer.
 */
export function dedupeQuestions<T extends Pick<QuestionData, "question" | "correctAnswer">>(
  questions: T[],
  threshold = 0.8
): T[] {
  const kept: { q: T; words: Set<string>; answer: string }[] = [];
  for (const q of questions) {
    const words = contentWords(q.question);
    const answer = normalizeAnswer(q.correctAnswer);
    const duplicate = kept.some((k) => {
      const { jaccard, containment } = overlap(words, k.words);
      return jaccard >= threshold || (answer === k.answer && containment >= 0.6);
    });
    if (!duplicate) kept.push({ q, words, answer });
  }
  return kept.map((k) => k.q);
}
