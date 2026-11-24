"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, UserMinus } from "lucide-react";
import { getCourseStaff, setCourseStaff } from "@/app/actions/members";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useCourses } from "@/hooks/use-courses";
import type { CourseRole, CourseStaffView } from "@/lib/types";

const selectClass = "h-9 px-2 rounded-md border border-input bg-white text-sm";
const STAFF_ROLES: { value: CourseRole; label: string }[] = [
  { value: "instructor", label: "Instructor" },
  { value: "assistant", label: "Assistant" },
];

/** Who teaches a course. Only members of the course's organization can be added. */
export function CourseStaff({ courseId }: { courseId: string }) {
  const { callAction, user } = useAuth();
  const { reload: reloadCourses } = useCourses();
  const [view, setView] = useState<CourseStaffView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState<CourseRole>("instructor");

  const load = useCallback(async () => {
    const result = await callAction((t) => getCourseStaff(t, courseId));
    if (result.success && result.data) setView(result.data);
    else setError(result.error ?? "Couldn't load the course staff.");
  }, [callAction, courseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async (uid: string, next: CourseRole | null, success: string) => {
    const result = await callAction((t) => setCourseStaff(t, courseId, uid, next));
    if (!result.success) {
      toast({ title: "Couldn't update staff", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: success });
    setCandidate("");
    await load();
    if (uid === user?.uid) await reloadCourses();
  };

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">Staff</h2>
      {view.staff.length === 0 ? (
        <p className="text-sm text-slate-500">No one is assigned yet. Organization owners and admins can still see this course.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Course staff">
          {view.staff.map((s) => (
            <li key={s.uid} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="text-sm text-slate-800">{s.email}</span>
              <span className="flex items-center gap-2">
                <select
                  aria-label={`Course role for ${s.email}`}
                  className={selectClass}
                  value={s.role}
                  onChange={(e) => save(s.uid, e.target.value as CourseRole, "Staff updated")}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-500 hover:text-rose-600"
                  aria-label={`Remove ${s.email} from course`}
                  onClick={() => {
                    if (s.uid !== user?.uid || confirm("Remove yourself from this course? You may lose access to it.")) {
                      void save(s.uid, null, "Removed from course");
                    }
                  }}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {view.candidates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="staff-candidate" className="text-sm font-medium">
              Add a member
            </label>
            <select id="staff-candidate" className={`block ${selectClass} h-10 min-w-[220px]`} value={candidate} onChange={(e) => setCandidate(e.target.value)}>
              <option value="">Choose…</option>
              {view.candidates.map((c) => (
                <option key={c.uid} value={c.uid}>
                  {c.email}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="staff-role" className="text-sm font-medium">
              As
            </label>
            <select id="staff-role" className={`block ${selectClass} h-10`} value={role} onChange={(e) => setRole(e.target.value as CourseRole)}>
              {STAFF_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <Button disabled={!candidate} onClick={() => save(candidate, role, "Added to course")}>
            Add to course
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Everyone in the organization is already on this course. Invite people from the Members tab.</p>
      )}
    </section>
  );
}
