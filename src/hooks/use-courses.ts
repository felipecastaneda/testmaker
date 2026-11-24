"use client";

import { useCallback, useEffect, useState } from "react";
import { listCourses } from "@/app/actions/courses";
import { useAuth } from "@/components/auth/AuthProvider";
import type { CoursesOverview } from "@/lib/types";

/** The signed-in user's organizations and courses, loaded once per mount. */
export function useCourses() {
  const { callAction } = useAuth();
  const [overview, setOverview] = useState<CoursesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    // Data fetching on mount; state updates happen after the await resolves.
    reload();
  }, [reload]);

  return { overview, error, reload };
}
