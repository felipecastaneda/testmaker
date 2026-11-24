/**
 * Tiny but valid PDF and PPTX files, built in memory for tests.
 */
import { createZip } from "../../src/lib/zip-writer";

const pdfEscape = (s: string) => s.replace(/[\\()]/g, "\\$&");

/** A PDF with one page per entry, each listing its lines (ASCII) in Helvetica. An empty page has no text. */
export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, i) => {
    const pageId = pageIds[i];
    const stream = lines.length ? `BT /F1 12 Tf 16 TL 72 720 Td ${lines.map((l) => `(${pdfEscape(l)}) Tj T*`).join(" ")} ET` : "";
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraphs = (lines: string[]) => lines.map((l) => `<a:p><a:r><a:t>${xmlEscape(l)}</a:t></a:r></a:p>`).join("");
const shape = (lines: string[], placeholder?: string) =>
  `<p:sp><p:nvSpPr><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs(lines)}</p:txBody></p:sp>`;

export interface Slide {
  lines: string[];
  notes?: string[];
}

/**
 * A .pptx whose slide files are numbered 1..n but shown in `order` (indexes into
 * `slides`), with notes files numbered differently from their slides, like real decks.
 */
export async function makePptx(slides: Slide[], order = slides.map((_, i) => i)): Promise<Uint8Array> {
  const parts: Record<string, string> = {
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation ${P} ${R}><p:sldIdLst>${order
      .map((i, n) => `<p:sldId id="${256 + n}" r:id="rId${i + 1}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  };
  slides.forEach((slide, i) => {
    const n = i + 1;
    parts[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0"?><p:sld ${A} ${P}><p:cSld><p:spTree>${shape(slide.lines)}</p:spTree></p:cSld></p:sld>`;
    if (slide.notes) {
      const notesNumber = 20 + n;
      parts[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${notesNumber}.xml"/></Relationships>`;
      parts[`ppt/notesSlides/notesSlide${notesNumber}.xml`] = `<?xml version="1.0"?><p:notes ${A} ${P}><p:cSld><p:spTree>${shape([], "sldImg")}${shape(
        slide.notes,
        "body"
      )}${shape([String(n)], "sldNum")}</p:spTree></p:cSld></p:notes>`;
    }
  });
  return createZip(Object.entries(parts).map(([name, data]) => ({ name, data })));
}
