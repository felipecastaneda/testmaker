"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, GraduationCap, Loader2, Lock, Plus, ShieldCheck, User, Users } from "lucide-react";
import { Navbar } from "@/components/TestMaker/Navbar";
import { useAccessGate } from "@/components/auth/AccessGate";
import { useAuth } from "@/components/auth/AuthProvider";
import { SettingField } from "@/components/settings/SettingField";
import { CourseStaff } from "@/components/settings/CourseStaff";
import { MembersTab } from "@/components/settings/MembersTab";
import { PlatformTab } from "@/components/settings/PlatformTab";
import { createInstitution } from "@/app/actions/members";
import { useCourses } from "@/hooks/use-courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { getSettings, updateCourseSettings, updateOrg, updatePrefs } from "@/app/actions/settings";
import { AVAILABLE_MODELS } from "@/ai/models";
import { GROUP_LABELS, SETTING_KEYS, SETTINGS, type SettingGroup, type SettingKey } from "@/lib/settings/registry";
import { resolveSetting } from "@/lib/settings/resolve";
import type { SettingsOverview } from "@/lib/types";

type Tab = "profile" | "organization" | "members" | "courses" | "platform";

const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "members", label: "Members", icon: Users },
  { id: "courses", label: "Courses", icon: GraduationCap },
  { id: "platform", label: "Platform", icon: ShieldCheck },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function keysFor(scope: "org" | "course"): SettingKey[] {
  return SETTING_KEYS.filter((k) => (SETTINGS[k].scopes as readonly string[]).includes(scope));
}

function groupKeys(keys: SettingKey[]): [SettingGroup, SettingKey[]][] {
  const groups = new Map<SettingGroup, SettingKey[]>();
  for (const k of keys) groups.set(SETTINGS[k].group, [...(groups.get(SETTINGS[k].group) ?? []), k]);
  return [...groups.entries()];
}

export default function SettingsPage() {
  const { ready, gate } = useAccessGate();
  const { callAction, access } = useAuth();
  const isPlatformAdmin = access.status === "allowed" && access.account.isPlatformAdmin;
  const tabs = TABS.filter((t) => t.id !== "platform" || isPlatformAdmin);
  const [tab, setTab] = useState<Tab>("profile");
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callAction(getSettings);
    if (result.success && result.data) {
      setOverview(result.data);
      setError(null);
    } else {
      setError(result.error ?? "Couldn't load your settings.");
    }
  }, [callAction]);

  useEffect(() => {
    // Data fetching once access is confirmed; state updates happen after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready) void load();
  }, [ready, load]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold font-headline text-slate-800">Settings</h1>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to TestMaker
              </Link>
            </Button>
          </div>

          {gate ? (
            <div className="bg-white rounded-2xl shadow p-6 md:p-10">{gate}</div>
          ) : (
            <>
              <div role="tablist" aria-label="Settings sections" className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl w-fit">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.id ? "bg-primary text-white shadow" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    <t.icon className="h-4 w-4" /> {t.label}
                  </button>
                ))}
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 md:p-8" role="tabpanel">
                {error ? (
                  <p className="text-sm text-rose-600">{error}</p>
                ) : !overview ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : tab === "profile" ? (
                  <ProfileTab overview={overview} onSaved={load} />
                ) : tab === "organization" ? (
                  <OrganizationTab overview={overview} onSaved={load} />
                ) : tab === "members" ? (
                  <MembersTab overview={overview} onSaved={load} />
                ) : tab === "platform" ? (
                  <PlatformTab />
                ) : (
                  <CoursesTab overview={overview} onSaved={load} />
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileTab({ overview, onSaved }: { overview: SettingsOverview; onSaved: () => Promise<void> }) {
  const { callAction, refreshAccount, signOut } = useAuth();
  const saved = overview.profile.selectedModels ?? AVAILABLE_MODELS.map((m) => m.id);
  const [models, setModels] = useState(saved);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await callAction((token) => updatePrefs(token, { selectedModels: models }));
    setSaving(false);
    if (!result.success) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Settings saved" });
    await Promise.all([onSaved(), refreshAccount()]);
  };

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-800">Account</h2>
        <p className="text-sm text-slate-600">
          Signed in as <span className="font-medium">{overview.profile.email}</span>
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={signOut}>
          Sign out
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800">Preferences</h2>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-800">Preferred AI models</legend>
          <div className="flex flex-wrap gap-4">
            {AVAILABLE_MODELS.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={models.includes(m.id)}
                  onChange={(e) => setModels(e.target.checked ? [...models, m.id] : models.filter((id) => id !== m.id))}
                />
                {m.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Selected by default when you generate. Models your organization hasn&apos;t enabled are skipped.
          </p>
        </fieldset>
        <Button onClick={save} disabled={saving || models.length === 0 || same(models, saved)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save preferences"}
        </Button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

function OrganizationTab({ overview, onSaved }: { overview: SettingsOverview; onSaved: () => Promise<void> }) {
  const { access } = useAuth();
  const canCreateInstitutions = access.status === "allowed" && access.account.canCreateInstitutions;
  const [picked, setOrgId] = useState<string | null>(null);
  const org = overview.orgs.find((o) => o.id === picked) ?? overview.orgs[0];
  const orgId = org?.id ?? "";
  if (!org) return <p className="text-sm text-slate-500">You don&apos;t belong to any organization yet.</p>;

  return (
    <div className="space-y-6">
      {canCreateInstitutions && (
        <NewInstitution
          onCreated={async (id) => {
            await onSaved();
            setOrgId(id);
          }}
        />
      )}
      {overview.orgs.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="org-select" className="text-sm font-medium">
            Organization
          </label>
          <select
            id="org-select"
            className="block w-full sm:w-72 h-10 px-3 rounded-md border border-input bg-white text-sm"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            {overview.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Keyed so the form resets when switching orgs or after saving. */}
      <OrgForm key={`${org.id}:${JSON.stringify(org.settings)}:${org.name}`} org={org} onSaved={onSaved} />
    </div>
  );
}

function OrgForm({ org, onSaved }: { org: SettingsOverview["orgs"][number]; onSaved: () => Promise<void> }) {
  const { callAction } = useAuth();
  const keys = keysFor("org");
  const initial = Object.fromEntries(keys.map((k) => [k, resolveSetting(k, org.settings).value])) as Record<SettingKey, unknown>;
  const initialLocked = Array.isArray(org.settings.locked) ? (org.settings.locked as string[]) : [];
  const [name, setName] = useState(org.name);
  const [draft, setDraft] = useState(initial);
  const [locked, setLocked] = useState<string[]>(initialLocked);
  const [saving, setSaving] = useState(false);
  const readOnly = !org.canManage;

  const changed = keys.filter((k) => !same(draft[k], initial[k]));
  const lockChanged = !same([...locked].sort(), [...initialLocked].sort());
  const nameChanged = name.trim() !== org.name;
  const dirty = changed.length > 0 || lockChanged || nameChanged;

  const save = async () => {
    setSaving(true);
    const result = await callAction((token) =>
      updateOrg(token, org.id, {
        ...(nameChanged ? { name: name.trim() } : {}),
        settings: {
          values: Object.fromEntries(changed.map((k) => [k, draft[k]])),
          ...(lockChanged ? { locked } : {}),
        },
      })
    );
    setSaving(false);
    if (!result.success) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Settings saved" });
    await onSaved();
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="org-name" className="text-sm font-medium">
            Name
          </label>
          <Input id="org-name" className="sm:w-72" value={name} maxLength={80} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="text-sm text-slate-600">
          Type: <span className="font-medium">{org.kind === "personal" ? "Individual workspace" : "Institution"}</span>
          {" · "}Your role: <span className="font-medium capitalize">{org.role}</span>
        </p>
        {readOnly && <p className="text-xs text-amber-700">Only owners and admins can change these settings.</p>}
      </section>

      {groupKeys(keys).map(([group, groupKeys]) => (
        <section key={group} className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">{GROUP_LABELS[group]}</h2>
          {groupKeys.map((k) => (
            <div key={k} className="space-y-2">
              <SettingField settingKey={k} value={draft[k]} disabled={readOnly} onChange={(v) => setDraft({ ...draft, [k]: v })} />
              {SETTINGS[k].lockable && (
                <label className="flex items-center gap-2 text-xs text-slate-600 ml-7 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={locked.includes(k)}
                    disabled={readOnly}
                    onChange={(e) => setLocked(e.target.checked ? [...locked, k] : locked.filter((x) => x !== k))}
                  />
                  <Lock className="h-3 w-3" /> Lock for all courses
                </label>
              )}
            </div>
          ))}
        </section>
      ))}

      {!readOnly && (
        <Button onClick={save} disabled={!dirty || saving || !name.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save organization settings"}
        </Button>
      )}
    </div>
  );
}

function NewInstitution({ onCreated }: { onCreated: (orgId: string) => Promise<void> }) {
  const { callAction } = useAuth();
  const { reload: reloadCourses } = useCourses();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await callAction((t) => createInstitution(t, name));
    setBusy(false);
    if (!result.success || !result.data) {
      toast({ title: "Couldn't create institution", description: result.error, variant: "destructive" });
      return;
    }
    await reloadCourses();
    await onCreated(result.data);
    toast({ title: "Institution created", description: `"${name.trim()}" is now your active organization.` });
    setOpen(false);
    setName("");
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> New institution
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
      <div className="space-y-1.5 flex-1 min-w-[220px]">
        <label htmlFor="institution-name" className="text-sm font-medium">
          Institution name
        </label>
        <Input id="institution-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g., Universidad Nacional" autoFocus />
      </div>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create institution"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

function CoursesTab({ overview, onSaved }: { overview: SettingsOverview; onSaved: () => Promise<void> }) {
  const manageable = overview.courses.filter((c) => c.canManage);
  const [picked, setCourseId] = useState<string | null>(null);
  const course = manageable.find((c) => c.id === picked) ?? manageable[0];
  const courseId = course?.id ?? "";
  if (!course) {
    return <p className="text-sm text-slate-500">You don&apos;t manage any courses. Create one from the library.</p>;
  }
  const org = overview.orgs.find((o) => o.id === course.orgId);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="course-select" className="text-sm font-medium">
          Course
        </label>
        <select
          id="course-select"
          className="block w-full sm:w-72 h-10 px-3 rounded-md border border-input bg-white text-sm"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
        >
          {manageable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Rename, archive or delete courses from the library.</p>
      </div>
      <CourseForm
        key={`${course.id}:${JSON.stringify(course.settings)}:${JSON.stringify(org?.settings)}`}
        course={course}
        orgSettings={org?.settings ?? {}}
        onSaved={onSaved}
      />
      {org?.kind === "institution" && <CourseStaff key={course.id} courseId={course.id} />}
    </div>
  );
}

function CourseForm({
  course,
  orgSettings,
  onSaved,
}: {
  course: SettingsOverview["courses"][number];
  orgSettings: SettingsOverview["orgs"][number]["settings"];
  onSaved: () => Promise<void>;
}) {
  const { callAction } = useAuth();
  const keys = keysFor("course");
  const resolved = Object.fromEntries(keys.map((k) => [k, resolveSetting(k, orgSettings, course.settings)])) as Record<
    SettingKey,
    ReturnType<typeof resolveSetting>
  >;
  // Course-only settings (no org scope) have nothing to inherit, so they're always "overridden".
  const courseOnly = (k: SettingKey) => !(SETTINGS[k].scopes as readonly string[]).includes("org");
  const initial = Object.fromEntries(
    keys.map((k) => [k, { override: resolved[k].source === "course" || courseOnly(k), value: resolved[k].value }])
  ) as Record<SettingKey, { override: boolean; value: unknown }>;
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  const orgValue = (k: SettingKey) => resolveSetting(k, orgSettings).value;
  const changed = keys.filter((k) => !same(draft[k], initial[k]));

  const save = async () => {
    setSaving(true);
    const values = Object.fromEntries(changed.map((k) => [k, draft[k].override ? draft[k].value : null]));
    const result = await callAction((token) => updateCourseSettings(token, course.id, { values }));
    setSaving(false);
    if (!result.success) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Settings saved" });
    await onSaved();
  };

  return (
    <div className="space-y-8">
      {groupKeys(keys).map(([group, groupKeys]) => (
        <section key={group} className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">{GROUP_LABELS[group]}</h2>
          {groupKeys.map((k) => {
            const lockedByOrg = resolved[k].locked;
            const d = draft[k];
            return (
              <div key={k} className="space-y-2" data-testid={`course-setting-${k}`}>
                <SettingField
                  settingKey={k}
                  value={lockedByOrg ? resolved[k].value : d.value}
                  disabled={lockedByOrg || !d.override}
                  onChange={(v) => setDraft({ ...draft, [k]: { override: true, value: v } })}
                />
                {lockedByOrg ? (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500 ml-7">
                    <Lock className="h-3 w-3" /> Set by your organization
                  </p>
                ) : (
                  !courseOnly(k) && (
                    <label className="flex items-center gap-2 text-xs text-slate-600 ml-7 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!d.override}
                        onChange={(e) =>
                          setDraft({ ...draft, [k]: { override: !e.target.checked, value: e.target.checked ? orgValue(k) : d.value } })
                        }
                      />
                      Use the organization&apos;s setting
                    </label>
                  )
                )}
              </div>
            );
          })}
        </section>
      ))}
      <Button onClick={save} disabled={changed.length === 0 || saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save course settings"}
      </Button>
    </div>
  );
}
