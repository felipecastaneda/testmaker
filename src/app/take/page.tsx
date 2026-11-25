"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidJoinCode, normalizeJoinCode } from "@/lib/assignments";

/** Students type the code their professor gave them. */
export default function EnterCodePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const normalized = normalizeJoinCode(code);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 items-center justify-center px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isValidJoinCode(normalized)) router.push(`/take/${normalized}`);
        }}
        className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 w-full max-w-sm space-y-5 text-center"
      >
        <GraduationCap className="mx-auto h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold font-headline text-slate-800">Join an exam</h1>
        <div className="space-y-1.5 text-left">
          <label htmlFor="join-code" className="text-sm font-medium">
            Exam code
          </label>
          <Input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. K7QM2XRA"
            className="font-mono text-lg tracking-widest uppercase text-center"
            autoComplete="off"
            autoFocus
          />
        </div>
        <Button type="submit" className="w-full" disabled={!isValidJoinCode(normalized)}>
          Continue
        </Button>
      </form>
    </div>
  );
}
