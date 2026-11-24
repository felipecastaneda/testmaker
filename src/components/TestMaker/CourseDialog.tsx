"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { createCourse, updateCourse } from "@/app/actions/courses";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import type { CourseSummary, CoursesOverview } from "@/lib/types";

interface CourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: CoursesOverview;
  /** Edit this course; omit to create a new one. */
  course?: CourseSummary;
  onSaved: (course: { id: string }) => void;
}

/** Create or rename a course. Mount it with a `key` so its fields reset each time it opens. */
export function CourseDialog({ open, onOpenChange, overview, course, onSaved }: CourseDialogProps) {
  const { callAction } = useAuth();
  const creatableOrgs = overview.orgs.filter((o) => o.canCreateCourses);
  const preferred = creatableOrgs.find((o) => o.id === overview.activeOrgId) ?? creatableOrgs[0];
  const [orgId, setOrgId] = useState(course?.orgId ?? preferred?.id ?? "");
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [term, setTerm] = useState(course?.term ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const input = { name: name.trim(), code: code.trim(), term: term.trim() };
    const result = course
      ? await callAction((token) => updateCourse(token, course.id, input))
      : await callAction((token) => createCourse(token, orgId, input));
    setSaving(false);
    if (!result.success) {
      toast({ title: course ? "Couldn't save course" : "Couldn't create course", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: course ? "Course saved" : "Course created", description: `"${input.name}"` });
    onSaved({ id: course?.id ?? (result.data as CourseSummary).id });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
            <DialogDescription>Courses group the tests you write for one class.</DialogDescription>
          </DialogHeader>

          {!course && creatableOrgs.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="course-org">Organization</Label>
              <select
                id="course-org"
                className="w-full h-10 px-3 rounded-md border border-input bg-white text-sm"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
              >
                {creatableOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="course-name">Course name</Label>
            <Input id="course-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g., Introduction to Biology" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="course-code">Code (optional)</Label>
              <Input id="course-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} placeholder="BIO-101" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-term">Term (optional)</Label>
              <Input id="course-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={40} placeholder="Spring 2027" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving || (!course && !orgId)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : course ? "Save" : "Create course"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
