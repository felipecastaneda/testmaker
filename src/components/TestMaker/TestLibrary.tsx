"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Calendar,
  ChevronRight,
  FileJson,
  FolderInput,
  FolderPlus,
  GraduationCap,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listTests, loadTest, deleteTest } from "@/app/actions/tests";
import { deleteCourse, moveTest, updateCourse } from "@/app/actions/courses";
import { useAuth } from "@/components/auth/AuthProvider";
import { CourseDialog } from "@/components/TestMaker/CourseDialog";
import { useCourses } from "@/hooks/use-courses";
import { useToast } from "@/hooks/use-toast";
import type { CourseSummary, StoredTest, TestSummary } from "@/lib/types";

interface TestLibraryProps {
  onSelectTest: (test: StoredTest) => void;
}

const ALL = "__all__";

export function TestLibrary({ onSelectTest }: TestLibraryProps) {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [courseDialog, setCourseDialog] = useState<{ course?: CourseSummary; key: number } | null>(null);
  const [moving, setMoving] = useState<TestSummary | null>(null);
  const { toast } = useToast();
  const { callAction } = useAuth();
  const { overview, error: coursesError, reload: reloadCourses } = useCourses();

  const fetchTests = useCallback(async () => {
    setLoading(true);
    const result = await callAction(listTests);
    if (result.success) {
      setTests(result.data ?? []);
      setLoadError(null);
    } else {
      setLoadError(result.error ?? "Couldn't reach the test library. Please try again.");
    }
    setLoading(false);
  }, [callAction]);

  useEffect(() => {
    // Data fetching on mount; state updates happen after the await resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTests();
  }, [fetchTests]);

  const refresh = () => Promise.all([fetchTests(), reloadCourses()]);

  const handleLoad = async (testId: string) => {
    setOpeningId(testId);
    const result = await callAction((token) => loadTest(token, testId));
    setOpeningId(null);
    if (result.success && result.data) {
      onSelectTest(result.data);
    } else {
      toast({ title: "Couldn't open test", description: result.error ?? "Unknown error.", variant: "destructive" });
    }
  };

  const handleDelete = async (testId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This also removes its archived versions.`)) return;
    const result = await callAction((token) => deleteTest(token, testId));
    if (result.success) {
      toast({ title: "Test Deleted", description: `"${name}" has been removed.` });
      setTests((prev) => prev.filter((t) => t.id !== testId));
    } else {
      toast({ title: "Delete failed", description: result.error ?? "Unknown error.", variant: "destructive" });
    }
  };

  const setArchived = async (course: CourseSummary, archived: boolean) => {
    const result = await callAction((token) => updateCourse(token, course.id, { archived }));
    if (!result.success) {
      toast({ title: "Couldn't update course", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: archived ? "Course archived" : "Course restored", description: `"${course.name}"` });
    if (archived && courseFilter === course.id && !showArchived) setCourseFilter(ALL);
    await reloadCourses();
  };

  const handleDeleteCourse = async (course: CourseSummary) => {
    if (!confirm(`Delete the course "${course.name}"?`)) return;
    const result = await callAction((token) => deleteCourse(token, course.id));
    if (!result.success) {
      toast({ title: "Couldn't delete course", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Course deleted", description: `"${course.name}"` });
    if (courseFilter === course.id) setCourseFilter(ALL);
    await reloadCourses();
  };

  const courses = overview?.courses ?? [];
  const orgName = (orgId: string) => overview?.orgs.find((o) => o.id === orgId)?.name;
  const multipleOrgs = (overview?.orgs.length ?? 0) > 1;
  const canCreate = overview?.orgs.some((o) => o.canCreateCourses) ?? false;
  const hasArchived = courses.some((c) => c.archived);
  const moveTargets = courses.filter((c) => c.canEdit && !c.archived);

  const query = search.trim().toLowerCase();
  const visibleCourses = courses.filter(
    (c) => (courseFilter === ALL ? showArchived || !c.archived : c.id === courseFilter)
  );
  const sections = visibleCourses
    .map((course) => ({
      course,
      tests: tests.filter((t) => t.courseId === course.id && t.name.toLowerCase().includes(query)),
    }))
    // While searching, only show courses with a match.
    .filter((s) => !query || s.tests.length > 0);
  const onlyDefaultCourse = courses.length === 1 && courses[0].isDefault;
  const loadingAll = loading || (!overview && !coursesError);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search your tests..."
              aria-label="Search tests"
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {courses.length > 1 && (
            <select
              aria-label="Filter by course"
              className="h-10 px-3 rounded-md border border-input bg-white text-sm sm:max-w-[220px]"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
            >
              <option value={ALL}>All courses</option>
              {courses
                .filter((c) => showArchived || !c.archived || c.id === courseFilter)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? " (archived)" : ""}
                  </option>
                ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasArchived && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 mr-1 cursor-pointer">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          )}
          {canCreate && overview && (
            <Button variant="outline" size="sm" onClick={() => setCourseDialog({ key: Date.now() })}>
              <FolderPlus className="mr-2 h-4 w-4" /> New course
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} className="w-fit" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {loadingAll ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Fetching your test library...</p>
        </div>
      ) : loadError || coursesError ? (
        <div className="text-center py-20 bg-rose-50 rounded-2xl border border-dashed border-rose-200">
          <h3 className="text-lg font-semibold text-rose-700">Library unavailable</h3>
          <p className="text-sm text-rose-600">{loadError ?? coursesError}</p>
        </div>
      ) : sections.length === 0 || (onlyDefaultCourse && tests.length === 0) ? (
        <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <FileJson className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-semibold text-slate-700">No tests found</h3>
          <p className="text-sm text-slate-500">
            {tests.length > 0 ? "No tests match your search." : "You haven't generated any tests yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map(({ course, tests: courseTests }) => (
            <section key={course.id} aria-label={course.name} data-testid="course-section" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <GraduationCap className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="font-semibold text-slate-800 truncate">{course.name}</h3>
                  {(course.code || course.term) && (
                    <span className="text-xs text-muted-foreground">{[course.code, course.term].filter(Boolean).join(" · ")}</span>
                  )}
                  {multipleOrgs && <Badge variant="outline" className="text-[10px]">{orgName(course.orgId)}</Badge>}
                  {course.archived && <Badge variant="secondary" className="text-[10px]">Archived</Badge>}
                </div>
                {course.canManage && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500" aria-label={`Edit course ${course.name}`} title="Edit course" onClick={() => setCourseDialog({ course, key: Date.now() })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!course.isDefault && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500"
                          aria-label={`${course.archived ? "Restore" : "Archive"} course ${course.name}`}
                          title={course.archived ? "Restore course" : "Archive course"}
                          onClick={() => setArchived(course, !course.archived)}
                        >
                          {course.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-rose-500"
                          aria-label={`Delete course ${course.name}`}
                          title="Delete course"
                          onClick={() => handleDeleteCourse(course)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {courseTests.length === 0 ? (
                <p className="text-sm text-slate-400 italic px-1">No tests in this course yet.</p>
              ) : (
                <div className="grid gap-4">
                  {courseTests.map((test) => (
                    <TestCard
                      key={test.id}
                      test={test}
                      canEdit={course.canEdit}
                      canMove={course.canEdit && moveTargets.some((c) => c.id !== course.id)}
                      opening={openingId === test.id}
                      busy={openingId !== null}
                      onOpen={() => handleLoad(test.id)}
                      onDelete={() => handleDelete(test.id, test.name)}
                      onMove={() => setMoving(test)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {courseDialog && overview && (
        <CourseDialog
          key={courseDialog.key}
          open
          onOpenChange={(open) => !open && setCourseDialog(null)}
          overview={overview}
          course={courseDialog.course}
          onSaved={() => reloadCourses()}
        />
      )}
      {moving && (
        <MoveTestDialog
          test={moving}
          targets={moveTargets.filter((c) => c.id !== moving.courseId)}
          orgName={multipleOrgs ? orgName : undefined}
          onClose={() => setMoving(null)}
          onMoved={(courseId) => setTests((prev) => prev.map((t) => (t.id === moving.id ? { ...t, courseId } : t)))}
        />
      )}
    </div>
  );
}

interface TestCardProps {
  test: TestSummary;
  canEdit: boolean;
  canMove: boolean;
  opening: boolean;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onMove: () => void;
}

function TestCard({ test, canEdit, canMove, opening, busy, onOpen, onDelete, onMove }: TestCardProps) {
  return (
    <Card data-testid="library-item" className="group hover:border-primary/40 hover:shadow-md transition-all duration-300">
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 gap-4">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <div className="bg-primary/10 p-3 rounded-xl text-primary group-hover:bg-primary group-hover:text-white transition-colors shrink-0">
              <FileJson className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-bold text-slate-800 truncate max-w-[200px] sm:max-w-md" title={test.name}>
                  {test.name}
                </h4>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                  v{test.version}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                {test.createdAt && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" title={`Last updated ${new Date(test.updatedAt).toLocaleString()}`}>
                    <Calendar className="h-3 w-3" />
                    {new Date(test.createdAt).toLocaleDateString()}
                  </div>
                )}
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  <span className="font-medium text-slate-600">{test.questionCount}</span> Questions
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-50">
            {canMove && (
              <Button variant="ghost" size="icon" aria-label={`Move ${test.name}`} title="Move to another course" className="text-slate-400 hover:text-primary h-9 w-9" onClick={onMove}>
                <FolderInput className="h-4 w-4" />
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${test.name}`}
                className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 h-9 w-9"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              onClick={onOpen}
              disabled={busy}
              className="flex-1 sm:flex-none rounded-full px-6 bg-slate-900 hover:bg-primary group-hover:scale-105 transition-all text-sm h-10"
            >
              {opening ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Open Test <ChevronRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MoveTestDialogProps {
  test: TestSummary;
  targets: CourseSummary[];
  orgName?: (orgId: string) => string | undefined;
  onClose: () => void;
  onMoved: (courseId: string) => void;
}

function MoveTestDialog({ test, targets, orgName, onClose, onMoved }: MoveTestDialogProps) {
  const { callAction } = useAuth();
  const { toast } = useToast();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    const result = await callAction((token) => moveTest(token, test.id, target));
    setSaving(false);
    if (!result.success) {
      toast({ title: "Couldn't move test", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Test moved", description: `"${test.name}" is now in ${targets.find((c) => c.id === target)?.name}.` });
    onMoved(target);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move &quot;{test.name}&quot;</DialogTitle>
          <DialogDescription>The test keeps its questions and version history.</DialogDescription>
        </DialogHeader>
        <label htmlFor="move-target" className="text-sm font-medium">
          Course
        </label>
        <select
          id="move-target"
          className="w-full h-10 px-3 rounded-md border border-input bg-white text-sm"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {targets.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {orgName ? ` (${orgName(c.orgId)})` : ""}
            </option>
          ))}
        </select>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!target || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
