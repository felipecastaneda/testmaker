"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Loader2 } from "lucide-react";
import { Navbar } from "@/components/TestMaker/Navbar";
import { useAccessGate } from "@/components/auth/AccessGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { AvailabilityBadge, formatWhen } from "@/components/assignments/AvailabilityBadge";
import { listAssignments } from "@/app/actions/assignments";
import { useCourses } from "@/hooks/use-courses";
import type { AssignmentSummary } from "@/lib/types";

export default function AssignmentsPage() {
  const { ready, gate } = useAccessGate();
  const { callAction } = useAuth();
  const { activeCourses } = useCourses();
  const [assignments, setAssignments] = useState<AssignmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    callAction((t) => listAssignments(t)).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setAssignments(result.data);
      else setError(result.error ?? "Couldn't load assignments.");
    });
    return () => {
      cancelled = true;
    };
  }, [ready, callAction]);

  // Like the library, show the active organization's courses.
  const courseName = new Map(activeCourses.map((c) => [c.id, c.name]));
  const visible = (assignments ?? []).filter((a) => courseName.has(a.courseId));

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <h1 className="text-3xl font-bold font-headline text-slate-800">Assignments</h1>
          {gate ? (
            <div className="bg-white rounded-2xl shadow p-6 md:p-10">{gate}</div>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : !assignments ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
              <ClipboardList className="mx-auto h-12 w-12 text-slate-300" />
              <h2 className="text-lg font-semibold text-slate-700">No assignments yet</h2>
              <p className="text-sm text-slate-500">Open a test from your library and choose &quot;Assign online&quot;.</p>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Assignments">
              {visible.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/assignments/${a.id}`}
                    className="block bg-white rounded-xl border border-slate-100 p-4 sm:p-5 hover:border-primary/40 hover:shadow-md transition-all"
                    data-testid="assignment-item"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-800 truncate">{a.title}</span>
                        <AvailabilityBadge availability={a.availability} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {a.stats.submitted} submitted · {a.stats.started} started
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {courseName.get(a.courseId)} · {a.questionCount} questions
                      {a.closesAt ? ` · closes ${formatWhen(a.closesAt)}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
