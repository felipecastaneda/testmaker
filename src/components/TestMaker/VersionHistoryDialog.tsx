"use client";

import React, { useEffect, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/components/auth/AuthProvider";
import { listVersions, restoreVersion } from "@/app/actions/tests";
import { toast } from "@/hooks/use-toast";
import type { TestVersionSummary } from "@/lib/types";

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
  currentVersion?: number;
  /** Called after a restore so the caller can reload the test. */
  onRestored: () => void;
}

export function VersionHistoryDialog({ open, onOpenChange, testId, currentVersion, onRestored }: VersionHistoryDialogProps) {
  const { callAction } = useAuth();
  const [versions, setVersions] = useState<TestVersionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    callAction((token) => listVersions(token, testId)).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setVersions(result.data ?? []);
        setError(null);
      } else {
        setError(result.error ?? "Couldn't load the version history.");
      }
    });
    return () => {
      cancelled = true;
      setVersions(null);
    };
  }, [open, testId, callAction]);

  const restore = async (version: number) => {
    if (!confirm(`Restore version ${version}? The current questions will be archived as a new version first, so nothing is lost.`)) return;
    setRestoring(version);
    const result = await callAction((token) => restoreVersion(token, testId, version));
    setRestoring(null);
    if (result.success) {
      toast({ title: "Version restored", description: `Version ${version} is now current (saved as v${result.data}).` });
      onOpenChange(false);
      onRestored();
    } else {
      toast({ title: "Restore failed", description: result.error, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Version history
          </DialogTitle>
          <DialogDescription>
            {currentVersion ? `You're viewing version ${currentVersion}. ` : ""}Earlier versions are archived whenever you save a new version.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : versions === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No earlier versions yet.</p>
        ) : (
          <ul className="divide-y max-h-80 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center justify-between py-3 gap-4">
                <div>
                  <p className="font-medium text-sm">Version {v.version}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.questionCount} questions · archived {v.archivedAt ? new Date(v.archivedAt).toLocaleString() : "—"}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="rounded-full" disabled={restoring !== null} onClick={() => restore(v.version)}>
                  {restoring === v.version ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
