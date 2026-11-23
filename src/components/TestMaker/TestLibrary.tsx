"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FileJson, Calendar, ChevronRight, Search, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listTests, loadTest, deleteTest } from "@/app/actions/load-test";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { StoredTest, TestSummary } from "@/lib/types";

interface TestLibraryProps {
  onSelectTest: (test: StoredTest) => void;
}

export function TestLibrary({ onSelectTest }: TestLibraryProps) {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const fetchTests = useCallback(async () => {
    setLoading(true);
    const result = await listTests();
    if (result.success) {
      setTests(result.tests ?? []);
      setLoadError(null);
    } else {
      setLoadError("Couldn't reach the test library. Check your Firebase configuration and try again.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Data fetching on mount; state updates happen after the await resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTests();
  }, [fetchTests]);

  const handleLoad = async (testId: string) => {
    setOpeningId(testId);
    const result = await loadTest(testId);
    setOpeningId(null);
    if (result.success && result.test) {
      onSelectTest(result.test);
    } else {
      toast({ title: "Couldn't open test", description: result.error ?? "Unknown error.", variant: "destructive" });
    }
  };

  const handleDelete = async (testId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? This also removes its archived versions.`)) return;
    const result = await deleteTest(testId);
    if (result.success) {
      toast({ title: "Test Deleted", description: `"${name}" has been removed.` });
      setTests((prev) => prev.filter((t) => t.id !== testId));
    } else {
      toast({ title: "Delete failed", description: result.error ?? "Unknown error.", variant: "destructive" });
    }
  };

  const filteredTests = tests.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
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
        <Button variant="outline" size="sm" onClick={fetchTests} className="w-fit" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Fetching your test library...</p>
        </div>
      ) : loadError ? (
        <div className="text-center py-20 bg-rose-50 rounded-2xl border border-dashed border-rose-200">
          <h3 className="text-lg font-semibold text-rose-700">Library unavailable</h3>
          <p className="text-sm text-rose-600">{loadError}</p>
        </div>
      ) : filteredTests.length === 0 ? (
        <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <FileJson className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-semibold text-slate-700">No tests found</h3>
          <p className="text-sm text-slate-500">
            {tests.length > 0 ? "No tests match your search." : "You haven't generated any tests yet."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredTests.map((test) => (
            <Card key={test.id} className="group hover:border-primary/40 hover:shadow-md transition-all duration-300">
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${test.name}`}
                      className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 h-9 w-9"
                      onClick={() => handleDelete(test.id, test.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => handleLoad(test.id)}
                      disabled={openingId !== null}
                      className="flex-1 sm:flex-none rounded-full px-6 bg-slate-900 hover:bg-primary group-hover:scale-105 transition-all text-sm h-10"
                    >
                      {openingId === test.id ? (
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
          ))}
        </div>
      )}
    </div>
  );
}
