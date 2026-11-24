"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, UserMinus } from "lucide-react";
import { createInvite, getOrgMembers, removeMember, revokeInvite, updateMemberRole } from "@/app/actions/members";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useCourses } from "@/hooks/use-courses";
import { assignableRoles, canChangeMember } from "@/lib/permissions";
import type { OrgMembersView, OrgRole, SettingsOverview } from "@/lib/types";

export const ROLE_NAMES: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  instructor: "Instructor",
  assistant: "Assistant",
};

const selectClass = "h-9 px-2 rounded-md border border-input bg-white text-sm disabled:opacity-60";

export function MembersTab({ overview, onSaved }: { overview: SettingsOverview; onSaved: () => Promise<void> }) {
  const orgs = overview.orgs.filter((o) => o.kind === "institution" && o.canManage);
  const [picked, setOrgId] = useState<string | null>(null);
  // Fall back to the first org if the pick isn't (or is no longer) available.
  const orgId = orgs.find((o) => o.id === picked)?.id ?? orgs[0]?.id;
  if (!orgId) {
    return (
      <p className="text-sm text-slate-500">
        Members are managed in institutions you own or administer. A personal workspace has only you; create an institution in the
        Organization tab to invite colleagues.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {orgs.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="members-org" className="text-sm font-medium">
            Organization
          </label>
          <select id="members-org" className={`block w-full sm:w-72 ${selectClass}`} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <OrgMembers key={orgId} orgId={orgId} onSaved={onSaved} />
    </div>
  );
}

function OrgMembers({ orgId, onSaved }: { orgId: string; onSaved: () => Promise<void> }) {
  const { callAction, user } = useAuth();
  const { reload: reloadCourses } = useCourses();
  const [view, setView] = useState<OrgMembersView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callAction((t) => getOrgMembers(t, orgId));
    if (result.success && result.data) setView(result.data);
    else setError(result.error ?? "Couldn't load members.");
  }, [callAction, orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (action: Parameters<typeof callAction>[0], success: string) => {
    const result = await callAction(action);
    if (!result.success) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return false;
    }
    toast({ title: success });
    return true;
  };

  const changeRole = async (uid: string, role: OrgRole) => {
    if (await run((t) => updateMemberRole(t, orgId, uid, role), "Role updated")) await load();
  };

  const remove = async (uid: string, email: string) => {
    const self = uid === user?.uid;
    if (!confirm(self ? "Leave this organization? You'll lose access to its courses." : `Remove ${email} from this organization?`)) return;
    if (!(await run((t) => removeMember(t, orgId, uid), self ? "You left the organization" : "Member removed"))) return;
    if (self) await Promise.all([reloadCourses(), onSaved()]);
    else await load();
  };

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">Members</h2>
        <ul className="divide-y divide-slate-100" aria-label="Members">
          {view.members.map((m) => {
            const self = m.uid === user?.uid;
            const roles = Array.from(new Set([m.role, ...assignableRoles(view.myRole)]));
            const canEdit = canChangeMember(view.myRole, m.role, m.role === "owner" ? "admin" : m.role);
            return (
              <li key={m.uid} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="member-row">
                <span className="text-sm text-slate-800">
                  {m.email}
                  {self && <span className="text-xs text-muted-foreground"> (you)</span>}
                </span>
                <span className="flex items-center gap-2">
                  <select
                    aria-label={`Role for ${m.email}`}
                    className={selectClass}
                    value={m.role}
                    disabled={!canEdit}
                    onChange={(e) => changeRole(m.uid, e.target.value as OrgRole)}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r} disabled={!canChangeMember(view.myRole, m.role, r)}>
                        {ROLE_NAMES[r]}
                      </option>
                    ))}
                  </select>
                  {(self || canChangeMember(view.myRole, m.role, null)) && (
                    <Button variant="ghost" size="sm" className="text-slate-500 hover:text-rose-600" onClick={() => remove(m.uid, m.email)}>
                      <UserMinus className="h-4 w-4 mr-1" /> {self ? "Leave" : "Remove"}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <InviteForm orgId={orgId} myRole={view.myRole} onInvited={load} />

      {view.invites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">Pending invites</h2>
          <ul className="divide-y divide-slate-100" aria-label="Pending invites">
            {view.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="text-sm text-slate-800">
                  {i.email} · {ROLE_NAMES[i.role]}
                  <span className="text-xs text-muted-foreground"> · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-500 hover:text-rose-600"
                  aria-label={`Revoke invite for ${i.email}`}
                  onClick={async () => {
                    if (await run((t) => revokeInvite(t, orgId, i.id), "Invite revoked")) await load();
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function InviteForm({ orgId, myRole, onInvited }: { orgId: string; myRole: OrgRole; onInvited: () => Promise<void> }) {
  const { callAction } = useAuth();
  const roles = assignableRoles(myRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("instructor");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await callAction((t) => createInvite(t, orgId, email, role));
    setBusy(false);
    if (!result.success || !result.data) {
      toast({ title: "Couldn't create invite", description: result.error, variant: "destructive" });
      return;
    }
    setLink(`${window.location.origin}/invite/${result.data.token}`);
    setCopied(false);
    setEmail("");
    await onInvited();
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(true);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2">Invite someone</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[220px]">
          <label htmlFor="invite-email" className="text-sm font-medium">
            Email
          </label>
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@university.edu" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Role
          </label>
          <select id="invite-role" className={`block ${selectClass} h-10`} value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create invite link"}
        </Button>
      </form>
      {link && (
        <div className="space-y-1.5 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <label htmlFor="invite-link" className="text-sm font-medium text-emerald-900">
            Invite link
          </label>
          <div className="flex gap-2">
            <Input id="invite-link" readOnly value={link} className="bg-white text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-emerald-800">
            Send this link to the person yourself. It works once, only for that email, for 14 days, and won&apos;t be shown again.
          </p>
        </div>
      )}
    </section>
  );
}
