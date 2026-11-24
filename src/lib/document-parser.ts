/**
 * Client-side text extraction for uploaded documents.
 *
 * .docx and .xlsx files are ZIP archives of XML parts. Instead of pulling in heavy
 * parsing libraries we read the ZIP central directory ourselves, inflate the parts we
 * need with the browser's native DecompressionStream, and walk the XML with DOMParser.
 */

const TEXT_EXTENSIONS = ["txt", "md", "csv", "tsv", "json"];
export const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, "docx", "xlsx", "pptx", "pdf"];

export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = getExtension(file.name);

  if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith("text/")) {
    return file.text();
  }
  if (ext === "docx") {
    return extractDocxText(await file.arrayBuffer());
  }
  if (ext === "xlsx") {
    return extractXlsxText(await file.arrayBuffer());
  }
  if (ext === "pptx") {
    return extractPptxText(await file.arrayBuffer());
  }
  if (ext === "pdf") {
    return extractPdfText(await file.arrayBuffer());
  }
  if (ext === "doc" || ext === "xls" || ext === "ppt") {
    throw new Error(
      `Legacy .${ext} files aren't supported. Re-save the file as .${ext}x and upload it again.`
    );
  }
  throw new Error(`Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readZipDirectory(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;

  // The end-of-central-directory record sits in the last 22 + up to 65535 (comment) bytes.
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("This file doesn't look like a valid Office document.");

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error(`Unsupported compression in "${entry.name}".`);

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

async function readXmlPart(
  buffer: ArrayBuffer,
  entries: Map<string, ZipEntry>,
  path: string
): Promise<Document | null> {
  const entry = entries.get(path);
  if (!entry) return null;
  const xml = await readZipEntry(buffer, entry);
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** getElementsByTagName ignoring namespace prefixes (w:p, x:c, etc.). */
function byLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const entries = readZipDirectory(buffer);
  const doc = await readXmlPart(buffer, entries, "word/document.xml");
  if (!doc) throw new Error("Couldn't find the document body in this .docx file.");

  const paragraphs = byLocalName(doc, "p").map((p) => {
    let text = "";
    // Walk runs in order so tabs and line breaks are preserved.
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
      switch (node.localName) {
        case "t":
          text += node.textContent ?? "";
          break;
        case "tab":
          text += "\t";
          break;
        case "br":
        case "cr":
          text += "\n";
          break;
      }
    }
    return text;
  });

  return paragraphs
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

async function extractXlsxText(buffer: ArrayBuffer): Promise<string> {
  const entries = readZipDirectory(buffer);

  const sharedStringsDoc = await readXmlPart(buffer, entries, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringsDoc
    ? byLocalName(sharedStringsDoc, "si").map((si) =>
        byLocalName(si, "t")
          .map((t) => t.textContent ?? "")
          .join("")
      )
    : [];

  // Map sheet names to their XML parts via the workbook relationships.
  const workbook = await readXmlPart(buffer, entries, "xl/workbook.xml");
  const rels = await readXmlPart(buffer, entries, "xl/_rels/workbook.xml.rels");
  const relTargets = new Map<string, string>();
  if (rels) {
    for (const rel of byLocalName(rels, "Relationship")) {
      const target = rel.getAttribute("Target") ?? "";
      const normalized = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      relTargets.set(rel.getAttribute("Id") ?? "", normalized);
    }
  }

  let sheets: { name: string; path: string }[] = [];
  if (workbook) {
    sheets = byLocalName(workbook, "sheet").map((sheet, i) => {
      const relId =
        sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
        sheet.getAttribute("r:id") ??
        "";
      return {
        name: sheet.getAttribute("name") ?? `Sheet${i + 1}`,
        path: relTargets.get(relId) ?? `xl/worksheets/sheet${i + 1}.xml`,
      };
    });
  }
  if (sheets.length === 0) {
    sheets = Array.from(entries.keys())
      .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
      .map((path, i) => ({ name: `Sheet${i + 1}`, path }));
  }

  const output: string[] = [];
  for (const sheet of sheets) {
    const doc = await readXmlPart(buffer, entries, sheet.path);
    if (!doc) continue;

    const rows = byLocalName(doc, "row")
      .map((row) =>
        byLocalName(row, "c")
          .map((cell) => {
            const type = cell.getAttribute("t");
            if (type === "inlineStr") {
              return byLocalName(cell, "t")
                .map((t) => t.textContent ?? "")
                .join("");
            }
            const value = byLocalName(cell, "v")[0]?.textContent ?? "";
            if (type === "s") return sharedStrings[Number(value)] ?? "";
            if (type === "b") return value === "1" ? "TRUE" : "FALSE";
            return value;
          })
          .filter((v) => v.trim() !== "")
          .join("\t")
      )
      .filter((line) => line.length > 0);

    if (rows.length > 0) {
      output.push(sheets.length > 1 ? `## ${sheet.name}\n${rows.join("\n")}` : rows.join("\n"));
    }
  }

  return output.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

const DRAWINGML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Resolve a relationship target (relative to `fromPart`) to a path inside the archive. */
function resolvePart(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

/** Relationship id → { type, target part } for the part at `partPath`. */
async function readRelationships(buffer: ArrayBuffer, entries: Map<string, ZipEntry>, partPath: string) {
  const slash = partPath.lastIndexOf("/");
  const relsPath = `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
  const rels = await readXmlPart(buffer, entries, relsPath);
  const out = new Map<string, { type: string; path: string }>();
  for (const rel of rels ? byLocalName(rels, "Relationship") : []) {
    out.set(rel.getAttribute("Id") ?? "", {
      type: rel.getAttribute("Type") ?? "",
      path: resolvePart(partPath, rel.getAttribute("Target") ?? ""),
    });
  }
  return out;
}

/** Slide parts in presentation order (falling back to slide1, slide2, ... by number). */
async function pptxSlidePaths(buffer: ArrayBuffer, entries: Map<string, ZipEntry>): Promise<string[]> {
  const presentation = await readXmlPart(buffer, entries, "ppt/presentation.xml");
  if (presentation) {
    const rels = await readRelationships(buffer, entries, "ppt/presentation.xml");
    const ordered = byLocalName(presentation, "sldId")
      .map((s) => rels.get(s.getAttributeNS(RELATIONSHIPS_NS, "id") ?? s.getAttribute("r:id") ?? "")?.path)
      .filter((path): path is string => !!path && entries.has(path));
    if (ordered.length) return ordered;
  }
  const number = (p: string) => Number(/slide(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  return Array.from(entries.keys())
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => number(a) - number(b));
}

/** Text of the DrawingML paragraphs under `root`, one line per paragraph. */
function drawingText(root: Element | Document): string {
  return Array.from(root.getElementsByTagNameNS(DRAWINGML_NS, "p"))
    .map((p) => {
      let text = "";
      for (const node of Array.from(p.getElementsByTagNameNS(DRAWINGML_NS, "*"))) {
        if (node.localName === "t") text += node.textContent ?? "";
        else if (node.localName === "br") text += "\n";
      }
      return text.trim();
    })
    .filter(Boolean)
    .join("\n");
}

/** Speaker notes: the notes body only, not the slide-number or slide-image placeholders. */
function notesText(notes: Document): string {
  return byLocalName(notes, "sp")
    .filter((shape) => {
      const type = byLocalName(shape, "ph")[0]?.getAttribute("type");
      return type === "body" || type === null || type === undefined;
    })
    .map((shape) => drawingText(shape))
    .filter(Boolean)
    .join("\n");
}

async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
  const entries = readZipDirectory(buffer);
  const slides = await pptxSlidePaths(buffer, entries);
  if (slides.length === 0) throw new Error("Couldn't find any slides in this .pptx file.");

  const output: string[] = [];
  for (const [i, path] of slides.entries()) {
    const slide = await readXmlPart(buffer, entries, path);
    if (!slide) continue;
    const text = drawingText(slide);
    const rels = await readRelationships(buffer, entries, path);
    const notesRel = [...rels.values()].find((r) => r.type.endsWith("/notesSlide"));
    const notesDoc = notesRel ? await readXmlPart(buffer, entries, notesRel.path) : null;
    const notes = notesDoc ? notesText(notesDoc) : "";
    if (!text && !notes) continue;
    // Slide markers keep the AI's source quotes easy to find in the deck.
    output.push([`--- Slide ${i + 1} ---`, text, notes && `Speaker notes:\n${notes}`].filter(Boolean).join("\n"));
  }
  return output.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Below this many non-space characters a PDF is treated as scanned images. */
const MIN_PDF_TEXT = 100;

/**
 * Load pdf.js on demand. Its worker module is imported too and handed over through
 * `globalThis.pdfjsWorker`, so pdf.js runs it on the main thread instead of fetching a
 * separate worker file (which Next.js can't reliably bundle). Text extraction for
 * documents of the sizes we accept is quick enough for that.
 */
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  const g = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= worker;
  return pdfjs;
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      // We only need text: no XFA forms, no fonts loaded into the page. (pdf.js 5 never
      // evaluates code from the PDF, so there's no isEvalSupported switch any more.)
      enableXfa: false,
      useSystemFonts: false,
      disableFontFace: true,
      // Font warnings only matter for drawing pages, which we never do.
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    }).promise;
  } catch (error) {
    if ((error as { name?: string })?.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Remove the password and upload it again.");
    }
    throw new Error("Couldn't read this PDF. It may be damaged.");
  }

  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      pages.push(text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
      page.cleanup();
    }
    if (pages.join("").replace(/\s/g, "").length < MIN_PDF_TEXT) {
      throw new Error(
        "This PDF looks scanned (its pages are images), so there's no text to read. Text recognition isn't supported yet: use a PDF exported from Word or PowerPoint, or paste the text."
      );
    }
    return pages
      .map((text, i) => (text ? `--- Page ${i + 1} ---\n${text}` : ""))
      .filter(Boolean)
      .join("\n\n");
  } finally {
    await doc.destroy();
  }
}
