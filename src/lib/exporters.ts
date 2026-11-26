import { createZip } from "./zip-writer";
import { formatPoints, optionLetter, orderOptions, pointsOf, totalPoints } from "./question-utils";
import { seededShuffle } from "./utils";
import type { QuestionData } from "./types";

export interface VariantQuestion {
  question: QuestionData;
  options: string[];
  correctIndex: number;
}

export interface TestVariant {
  /** "A", "B", "C", ... */
  label: string;
  questions: VariantQuestion[];
}

/**
 * Build `count` printable versions of a test. Version A keeps the current question
 * order; later versions also shuffle the question order. Every version has its own
 * answer-option order, so neighbours can't copy answers. `seed` makes a different, but
 * still repeatable, set of versions (paper assignments use their own).
 */
export function buildVariants(questions: QuestionData[], count: number, seed = "variant"): TestVariant[] {
  return Array.from({ length: Math.max(1, count) }, (_, v) => {
    const label = optionLetter(v);
    const ordered = v === 0 ? questions : seededShuffle(questions, `${seed}:${label}`);
    return {
      label,
      questions: ordered.map((q) => {
        const options = orderOptions(q, `${seed}:${label}`);
        return { question: q, options, correctIndex: options.indexOf(q.correctAnswer) };
      }),
    };
  });
}

const variantTitle = (title: string, variant: TestVariant, total: number) =>
  total > 1 ? `${title} (Version ${variant.label})` : title;

/** "12 questions · 15 pts" */
const summary = (variant: TestVariant) =>
  `${variant.questions.length} questions · ${formatPoints(totalPoints(variant.questions.map((v) => v.question)))}`;

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export function toPlainText(title: string, variants: TestVariant[]): string {
  return variants
    .map((variant) => {
      const heading = variantTitle(title, variant, variants.length);
      const body = variant.questions
        .map(({ question, options, correctIndex }, i) =>
          [
            `Q${i + 1} (${formatPoints(pointsOf(question))}): ${question.question}`,
            ...options.map((opt, idx) => `   ${optionLetter(idx)}) ${opt}`),
            `Answer: ${optionLetter(correctIndex)}) ${question.correctAnswer}`,
            ...(question.explanation ? [`Why: ${question.explanation}`] : []),
          ].join("\n")
        )
        .join("\n\n");
      return `${heading}\n${"=".repeat(heading.length)}\n${summary(variant)}\n\n${body}\n`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Printable HTML (save as PDF from the print dialog)
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toPrintableHtml(title: string, variants: TestVariant[]): string {
  const sections = variants
    .map((variant, vIdx) => {
      const heading = escapeHtml(variantTitle(title, variant, variants.length));
      const questionHtml = variant.questions
        .map(
          ({ question, options }, i) => `<section class="q">
            <p class="stem"><strong>${i + 1}.</strong> ${escapeHtml(question.question)} <span class="pts">(${formatPoints(pointsOf(question))})</span></p>
            <ol type="A">${options.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ol>
          </section>`
        )
        .join("");
      const keyHtml = variant.questions
        .map(
          ({ question, correctIndex }, i) =>
            `<li>${i + 1}. <strong>${optionLetter(correctIndex)}</strong> — ${escapeHtml(question.correctAnswer)}</li>`
        )
        .join("");
      return `<div class="${vIdx > 0 ? "page" : ""}">
          <h1>${heading}</h1>
          <p class="meta">${escapeHtml(summary(variant))} · Name: ______________________ · Date: __________ · Score: ______</p>
          ${questionHtml}
        </div>
        <div class="page key"><h2>Answer Key — ${heading}</h2><ul>${keyHtml}</ul></div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; color: #0f172a; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.5; }
      h1 { font-size: 24px; margin-bottom: 4px; }
      .meta { color: #64748b; font-size: 13px; margin-bottom: 32px; }
      .q { break-inside: avoid; margin-bottom: 20px; }
      .stem { margin: 0 0 6px; }
      .pts { color: #64748b; font-size: 12px; white-space: nowrap; }
      ol { margin: 0; padding-left: 28px; }
      li { margin: 2px 0; }
      .page { break-before: page; }
      .key ul { list-style: none; padding: 0; columns: 2; }
    </style></head><body>${sections}
    <script>window.onload = () => { window.print(); };</script>
    </body></html>`;
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Strip characters that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function paragraph(text: string, opts: { bold?: boolean; size?: number; indent?: number; pageBreakBefore?: boolean; spaceAfter?: number } = {}) {
  const pPr = [
    opts.pageBreakBefore ? "<w:pageBreakBefore/>" : "",
    opts.indent ? `<w:ind w:left="${opts.indent}"/>` : "",
    `<w:spacing w:after="${opts.spaceAfter ?? 80}"/>`,
  ].join("");
  const rPr = [opts.bold ? "<w:b/>" : "", opts.size ? `<w:sz w:val="${opts.size}"/>` : ""].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

export function buildDocxDocumentXml(title: string, variants: TestVariant[]): string {
  const body: string[] = [];
  variants.forEach((variant, vIdx) => {
    const heading = variantTitle(title, variant, variants.length);
    body.push(paragraph(heading, { bold: true, size: 36, pageBreakBefore: vIdx > 0, spaceAfter: 120 }));
    body.push(paragraph(`${summary(variant)}    Name: ____________________    Date: __________    Score: ______`, { spaceAfter: 360 }));
    variant.questions.forEach(({ question, options }, i) => {
      body.push(paragraph(`${i + 1}. ${question.question} (${formatPoints(pointsOf(question))})`, { bold: true, spaceAfter: 60 }));
      options.forEach((opt, idx) => body.push(paragraph(`${optionLetter(idx)}) ${opt}`, { indent: 360, spaceAfter: 20 })));
      body.push(paragraph("", { spaceAfter: 120 }));
    });
    body.push(paragraph(`Answer Key — ${heading}`, { bold: true, size: 28, pageBreakBefore: true, spaceAfter: 200 }));
    variant.questions.forEach(({ question, correctIndex }, i) => {
      body.push(paragraph(`${i + 1}. ${optionLetter(correctIndex)} — ${question.correctAnswer}`, { spaceAfter: 40 }));
    });
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export async function toDocx(title: string, variants: TestVariant[]): Promise<Blob> {
  const zip = await createZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", data: buildDocxDocumentXml(title, variants) },
  ]);
  return new Blob([zip as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ---------------------------------------------------------------------------
// Moodle: GIFT and Aiken
// ---------------------------------------------------------------------------

/** GIFT reserves ~ = # { } : and backslash. */
export function escapeGift(text: string): string {
  return text.replace(/([\\~=#{}:])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

/**
 * GIFT import format (Moodle). Moodle shuffles options itself, so no variants here.
 * GIFT has no per-question mark, so points aren't exported; set them in Moodle.
 */
export function toGift(title: string, questions: QuestionData[]): string {
  const header = `// ${title.replace(/\r?\n/g, " ")}\n// Exported from TestMaker\n\n`;
  return (
    header +
    questions
      .map((q, i) => {
        const name = `::Q${i + 1}::`;
        const feedback = q.explanation ? ` ####${escapeGift(q.explanation)}` : "";
        if (q.type === "true_false") {
          return `${name}${escapeGift(q.question)} {${q.correctAnswer === "True" ? "TRUE" : "FALSE"}${feedback}}`;
        }
        const answers = [`=${escapeGift(q.correctAnswer)}`, ...q.distractors.map((d) => `~${escapeGift(d)}`)];
        return `${name}${escapeGift(q.question)} {\n  ${answers.join("\n  ")}\n ${feedback}\n}`;
      })
      .join("\n\n") +
    "\n"
  );
}

/** Aiken import format (Moodle). Single-line text, at most 26 options, one answer letter. */
export function toAiken(questions: QuestionData[]): string {
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  return (
    questions
      .map((q) => {
        const options = orderOptions(q, "aiken");
        const correct = options.indexOf(q.correctAnswer);
        return [
          oneLine(q.question),
          ...options.map((o, i) => `${optionLetter(i)}. ${oneLine(o)}`),
          `ANSWER: ${optionLetter(correct)}`,
        ].join("\n");
      })
      .join("\n\n") + "\n"
  );
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

export function fileSafeName(name: string): string {
  return name.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "TestMaker_Exam";
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
