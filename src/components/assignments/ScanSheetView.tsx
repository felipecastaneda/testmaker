"use client";

import { project, sheetToImage, type MarkFlag, type Point } from "@/lib/omr";
import type { PaperLetters } from "@/lib/paper";
import { BUBBLE_RADIUS, sheetLayout } from "@/lib/paper-sheet";
import type { PaperOptions } from "@/lib/types";

interface ScanSheetViewProps {
  src: string;
  width: number;
  height: number;
  /** Corner-square centres in this image's pixels (TL, TR, BR, BL of the sheet). */
  corners: Point[];
  paper: Pick<PaperOptions, "idLength" | "idCharset">;
  optionCounts: number[];
  letters: PaperLetters;
  /** Per question: why it needs checking. */
  flags?: (MarkFlag | null)[];
  /** Highlight one question (1-based numbers are shown elsewhere). */
  focus?: number | null;
}

/** The scanned sheet with what was read drawn on top: green = counted answer, amber = needs checking. */
export function ScanSheetView({ src, width, height, corners, paper, optionCounts, letters, flags, focus }: ScanSheetViewProps) {
  const H = sheetToImage(corners);
  const layout = sheetLayout(paper, optionCounts);
  const at = (cx: number, cy: number) => {
    const p = project(H, { x: cx, y: cy });
    const edge = project(H, { x: cx + BUBBLE_RADIUS + 0.6, y: cy });
    return { ...p, r: Math.hypot(edge.x - p.x, edge.y - p.y) };
  };

  return (
    <div className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the server or the browser */}
      <img src={src} alt="Scanned answer sheet" className="absolute inset-0 w-full h-full select-none" draggable={false} />
      <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        {layout.answerBubbles.map((row, q) => {
          const flagged = flags?.[q];
          return row.map((c, o) => {
            const chosen = letters[q] === o;
            if (!chosen && !flagged && focus !== q) return null;
            const { x, y, r } = at(c.cx, c.cy);
            return (
              <circle
                key={`${q}-${o}`}
                cx={x}
                cy={y}
                r={r}
                fill="none"
                strokeWidth={Math.max(1.5, r * 0.25)}
                stroke={chosen ? (flagged ? "#d97706" : "#059669") : flagged ? "#f59e0b" : "#6366f1"}
                strokeDasharray={chosen ? undefined : `${r * 0.6} ${r * 0.4}`}
              />
            );
          });
        })}
      </svg>
    </div>
  );
}
