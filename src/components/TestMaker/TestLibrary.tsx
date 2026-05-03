"use client";

import React, { useEffect, useState } from "react";
import { FileJson, Calendar, ChevronRight, Search, Clock, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listTests, loadTest } from "@/app/actions/load-test";
import { Badge } from "@/components/ui/badge";

interface TestLibraryProps {
  onSelectTest: (questions: any[]) => void;
}

export function TestLibrary({ onSelectTest }: TestLibraryProps) {
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchTests();
  }, []);

  const fetchTests = async () => {
    setLoading(true);
    const result = await listTests();
    if (result.success) {
      setTests(result.tests || []);
    }
    setLoading(false);
  };

  const handleLoad = async (fileName: string) => {
    const result = await loadTest(fileName);
    if (result.success && result.test) {
      onSelectTest(result.test.questions);
    }
  };

  const filteredTests = tests.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search your tests..." 
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={fetchTests} className="w-fit">
          <Clock className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Fetching your test library...</p>
        </div>
      ) : filteredTests.length === 0 ? (
        <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <FileJson className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-semibold text-slate-700">No tests found</h3>
          <p className="text-sm text-slate-500">You haven't generated any tests yet or the directory is empty.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredTests.map((test) => (
            <Card key={test.id} className="group hover:border-primary/40 hover:shadow-md transition-all duration-300">
              <CardContent className="p-0">
                <div className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-3 rounded-xl text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                      <FileJson className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-800">{test.name}</h4>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">v{test.version}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(test.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium text-slate-600">{test.questionCount}</span> Questions
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-slate-400 hover:text-rose-500 hover:bg-rose-50"
                      onClick={(e) => { e.stopPropagation(); /* TODO: Delete logic */ }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button 
                      onClick={() => handleLoad(test.id)}
                      className="rounded-full px-6 bg-slate-900 hover:bg-primary group-hover:scale-105 transition-all"
                    >
                      Open Test <ChevronRight className="ml-1 h-4 w-4" />
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
