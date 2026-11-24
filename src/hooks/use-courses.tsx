"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { listCourses } from "@/app/actions/courses";
import { setActiveOrg as setActiveOrgAction } from "@/app/actions/members";
import { useAuth } from "@/components/auth/AuthProvider";
import { toast } from "@/hooks/use-toast";
import type { CourseSummary, CoursesOverview } from "@/lib/types";

interface CoursesContextValue {
  overview: CoursesOverview | null;
  error: string | null;
  reload: () => Promise<CoursesOverview | null>;
  /** Courses in the active organization (all courses when the user has only one org). */
  activeCourses: CourseSummary[];
  setActiveOrg: (orgId: string) => Promise<void>;
}

const CoursesContext = createContext<CoursesContextValue | null>(null);

/** The signed-in user's organizations and courses, shared by the navbar, library and forms. */
export function CoursesProvider({ children }: { children: React.ReactNode }) {
  const { access, callAction, user } = useAuth();
  const [overview, setOverview] = useState<CoursesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = access.status === "allowed";

  const reload = useCallback(async () => {
    const result = await callAction(listCourses);
    if (result.success && result.data) {
      setOverview(result.data);
      setError(null);
    } else {
      setError(result.error ?? "Couldn't load your courses.");
    }
    return result.data ?? null;
  }, [callAction]);

  useEffect(() => {
    // Load once the user has access; forget everything when they sign out or switch.
    setOverview(null);
    if (allowed) void reload();
  }, [allowed, user?.uid, reload]);

  const setActiveOrg = useCallback(
    async (orgId: string) => {
      setOverview((prev) => (prev ? { ...prev, activeOrgId: orgId } : prev));
      const result = await callAction((token) => setActiveOrgAction(token, orgId));
      if (!result.success) toast({ title: "Couldn't switch organization", description: result.error, variant: "destructive" });
    },
    [callAction]
  );

  const value = useMemo<CoursesContextValue>(() => {
    const multipleOrgs = (overview?.orgs.length ?? 0) > 1;
    const activeCourses = (overview?.courses ?? []).filter((c) => !multipleOrgs || c.orgId === overview?.activeOrgId);
    return { overview, error, reload, activeCourses, setActiveOrg };
  }, [overview, error, reload, setActiveOrg]);

  return <CoursesContext.Provider value={value}>{children}</CoursesContext.Provider>;
}

export function useCourses(): CoursesContextValue {
  const ctx = useContext(CoursesContext);
  if (!ctx) throw new Error("useCourses must be used inside <CoursesProvider>");
  return ctx;
}
