"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getPlatform, updatePlatform, type PlatformView } from "@/app/actions/members";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

/** Who may use TestMaker at all. Visible to PLATFORM_ADMIN_EMAILS only. */
export function PlatformTab() {
  const { callAction } = useAuth();
  const [saved, setSaved] = useState<PlatformView | null>(null);
  const [mode, setMode] = useState<PlatformView["signupMode"]>("allowlist");
  const [emails, setEmails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    callAction(getPlatform).then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) return setError(result.error ?? "Couldn't load platform settings.");
      setSaved(result.data);
      setMode(result.data.signupMode);
      setEmails(result.data.allowedEmails.join("\n"));
    });
    return () => {
      cancelled = true;
    };
  }, [callAction]);

  const list = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const save = async () => {
    setSaving(true);
    const change = { signupMode: mode, allowedEmails: list };
    const result = await callAction((t) => updatePlatform(t, change));
    setSaving(false);
    if (!result.success) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    setSaved(change);
    toast({ title: "Platform settings saved" });
  };

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!saved) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">Who can use TestMaker</legend>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name="signup" className="mt-1" checked={mode === "allowlist"} onChange={() => setMode("allowlist")} />
          <span>
            <span className="font-medium">Allow-list</span>
            <span className="block text-xs text-muted-foreground">
              Only the emails below (plus ALLOWED_EMAILS on the server), and people invited into an institution.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="radio" name="signup" className="mt-1" checked={mode === "open"} onChange={() => setMode("open")} />
          <span>
            <span className="font-medium">Open</span>
            <span className="block text-xs text-muted-foreground">
              Anyone with a verified email, who can also create institutions. Daily question limits still apply.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="allowed-emails" className="text-sm font-medium text-slate-800">
          Allowed emails
        </label>
        <Textarea
          id="allowed-emails"
          className="min-h-[160px] text-sm font-mono bg-white"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder={"one@example.com\ntwo@example.com"}
        />
        <p className="text-xs text-muted-foreground">One per line. {list.length} email{list.length === 1 ? "" : "s"}.</p>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save platform settings"}
      </Button>
    </div>
  );
}
