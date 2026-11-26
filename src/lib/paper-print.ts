import { escapeHtml, type TestVariant } from "./exporters";
import { answerSheetSvg, sheetCodeBits } from "./paper-sheet";
import { formatPoints, optionLetter, pointsOf, totalPoints } from "./question-utils";
import type { PaperOptions } from "./types";

export interface PaperPrintInput {
  assignmentId: string;
  title: string;
  subtitle: string;
  paper: PaperOptions;
  variants: TestVariant[];
  /** Question booklets, one per version. */
  booklets: boolean;
  /** Blank answer sheets per version (0 = none). */
  sheetsPerVersion: number;
  keys: boolean;
}

export const MAX_SHEETS_PER_VERSION = 300;

/**
 * One printable document (print, or save as PDF) for a paper assignment. Pages are sized for
 * both Letter and A4: the answer sheet is a fixed 190 × 255 mm drawing, centred.
 */
export function paperPrintHtml(input: PaperPrintInput): string {
  const { variants, paper } = input;
  const many = variants.length > 1;
  const pages: string[] = [];

  if (input.booklets) {
    for (const v of variants) {
      const questions = v.questions
        .map(
          ({ question, options }, i) => `<section class="q">
            <p class="stem"><strong>${i + 1}.</strong> ${escapeHtml(question.question)} <span class="pts">(${formatPoints(pointsOf(question))})</span></p>
            <ol type="A">${options.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ol>
          </section>`
        )
        .join("");
      pages.push(`<div class="booklet" style="page: v${v.label}" data-version="${v.label}">
        <h1>${escapeHtml(input.title)}${many ? ` <span class="ver">Version ${v.label}</span>` : ""}</h1>
        <p class="meta">${escapeHtml(input.subtitle)}${input.subtitle ? " · " : ""}${v.questions.length} questions · ${formatPoints(totalPoints(v.questions.map((q) => q.question)))}</p>
        <p class="note">Mark your answers on the answer sheet${many ? `, and check it says <strong>Version ${v.label}</strong>` : ""}. Answers written in this booklet aren't graded.</p>
        ${questions}
      </div>`);
    }
  }

  if (input.sheetsPerVersion > 0) {
    for (const [index, v] of variants.entries()) {
      const svg = answerSheetSvg(
        { title: input.title, subtitle: input.subtitle, versionLabel: v.label, showVersion: many },
        paper,
        v.questions.map((q) => q.options.length),
        sheetCodeBits(input.assignmentId, index)
      );
      for (let i = 0; i < Math.min(input.sheetsPerVersion, MAX_SHEETS_PER_VERSION); i++) {
        pages.push(`<div class="sheet-page" data-version="${v.label}">${svg}</div>`);
      }
    }
  }

  if (input.keys) {
    for (const v of variants) {
      const rows = v.questions
        .map(({ question, correctIndex }, i) => `<li><span class="n">${i + 1}.</span> <strong>${optionLetter(correctIndex)}</strong> <span class="pts">${formatPoints(pointsOf(question))}</span></li>`)
        .join("");
      pages.push(`<div class="key" style="page: v${v.label}" data-version="${v.label}">
        <h2>Answer key — ${escapeHtml(input.title)}${many ? ` · Version ${v.label}` : ""}</h2>
        <ol class="keylist">${rows}</ol>
      </div>`);
    }
  }

  const versionPages = variants
    .map((v) => `@page v${v.label} { margin: 14mm 16mm; ${many ? `@top-right { content: "Version ${v.label}"; font: 600 10pt Arial, sans-serif; }` : ""} }`)
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title)} — paper exam</title>
    <style>
      @page { size: auto; margin: 0; }
      ${versionPages}
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .booklet, .key, .sheet-page { break-after: page; }
      .booklet:last-child, .key:last-child, .sheet-page:last-child { break-after: auto; }
      .booklet, .key { max-width: 720px; margin: 0 auto; padding: 0; line-height: 1.45; font-size: 11pt; }
      h1 { font-size: 18pt; margin: 0 0 4px; }
      h1 .ver { font-size: 13pt; border: 1.5px solid #0f172a; border-radius: 4px; padding: 0 6px; margin-left: 8px; vertical-align: middle; }
      .meta { color: #475569; font-size: 10pt; margin: 0 0 6px; }
      .note { font-size: 10pt; background: #f1f5f9; padding: 6px 10px; border-radius: 4px; margin: 0 0 18px; }
      .q { break-inside: avoid; margin-bottom: 14px; }
      .stem { margin: 0 0 4px; }
      .pts { color: #64748b; font-size: 9pt; white-space: nowrap; }
      ol { margin: 0; padding-left: 26px; }
      .keylist { list-style: none; padding: 0; columns: 4; font-size: 11pt; }
      .keylist li { margin: 2px 0; break-inside: avoid; }
      .keylist .n { display: inline-block; width: 2.4em; text-align: right; color: #475569; }
      /* The sheet is a fixed-size drawing, centred on whatever paper the printer uses. */
      .sheet-page { height: 100vh; display: flex; align-items: center; justify-content: center; }
      .sheet { width: 190mm; height: 255mm; display: block; }
      @media screen {
        body { background: #e2e8f0; padding: 24px 0; }
        .booklet, .key { background: #fff; padding: 32px; margin-bottom: 24px; }
        .sheet-page { height: auto; margin-bottom: 24px; }
        .sheet { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
      }
    </style></head><body>${pages.join("\n")}
    <script>window.onload = () => { window.print(); };</script>
    </body></html>`;
}
