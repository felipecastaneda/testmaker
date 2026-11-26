import { loadPdfjs } from "./document-parser";
import { toGray, type GrayImage, type Point } from "./omr";

/*
 * Browser-only: turn uploaded photos and scanner PDFs into page images for the sheet reader,
 * and into the JPEG that's stored with each attempt.
 */

/** Long side used for reading (enough for 4+ px per mm on a full-page photo). */
const READ_LONG_SIDE = 1800;
/** Long side of the stored image. */
const STORE_LONG_SIDE = 1400;
export const MAX_PDF_PAGES = 300;

export interface PageImage {
  /** "photo.jpg" or "scan.pdf · page 3". */
  label: string;
  canvas: HTMLCanvasElement;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't process images.");
  return ctx;
}

/** Every page in a file: one for an image, one per page for a PDF. */
export async function filePages(file: File): Promise<PageImage[]> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
    if (doc.numPages > MAX_PDF_PAGES) throw new Error(`${file.name} has ${doc.numPages} pages; scan at most ${MAX_PDF_PAGES} sheets per file.`);
    const pages: PageImage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: READ_LONG_SIDE / Math.max(base.width, base.height) });
      const canvas = canvasOf(viewport.width, viewport.height);
      const ctx = context(canvas);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push({ label: doc.numPages > 1 ? `${file.name} · page ${n}` : file.name, canvas });
    }
    return pages;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`Couldn't open ${file.name}. Use a JPG, PNG or PDF (iPhone photos: set the camera to "Most Compatible").`);
  }
  const scale = Math.min(1, READ_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = canvasOf(bitmap.width * scale, bitmap.height * scale);
  context(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return [{ label: file.name, canvas }];
}

export function grayOf(canvas: HTMLCanvasElement): GrayImage {
  const { data } = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return toGray(data, canvas.width, canvas.height);
}

/** The stored copy: a smaller JPEG, with the corner positions scaled to match it. */
export async function storedImage(
  canvas: HTMLCanvasElement,
  corners: Point[]
): Promise<{ base64: string; width: number; height: number; corners: Point[]; url: string }> {
  const scale = Math.min(1, STORE_LONG_SIDE / Math.max(canvas.width, canvas.height));
  const out = canvasOf(canvas.width * scale, canvas.height * scale);
  context(out).drawImage(canvas, 0, 0, out.width, out.height);
  const url = out.toDataURL("image/jpeg", 0.8);
  return {
    base64: url.slice(url.indexOf(",") + 1),
    width: out.width,
    height: out.height,
    corners: corners.map((c) => ({ x: c.x * (out.width / canvas.width), y: c.y * (out.height / canvas.height) })),
    url,
  };
}
