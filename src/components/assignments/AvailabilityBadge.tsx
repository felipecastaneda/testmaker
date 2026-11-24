import { Badge } from "@/components/ui/badge";
import type { AssignmentAvailability } from "@/lib/types";

const STYLES: Record<AssignmentAvailability, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600 border-slate-200" },
  scheduled: { label: "Scheduled", className: "bg-sky-50 text-sky-700 border-sky-200" },
  open: { label: "Open", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "Closed", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

export function AvailabilityBadge({ availability }: { availability: AssignmentAvailability }) {
  const s = STYLES[availability];
  return (
    <Badge variant="outline" className={`text-[11px] ${s.className}`} data-testid="availability">
      {s.label}
    </Badge>
  );
}

export function formatWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}
