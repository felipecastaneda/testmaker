import "server-only";
import { adminDb } from "./admin";
import type { AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { getOrgRole, listViewableCourses, requireCourseAccess } from "./workspace";
import { isOrgAdmin } from "@/lib/permissions";
import { lockedKeys, resolveSetting, validateSettingsPatch, type SettingsPatch, type StoredSettings } from "@/lib/settings/resolve";
import { isSettingKey } from "@/lib/settings/registry";
import type { SettingsOverview } from "@/lib/types";

const ORGS = "orgs";
const COURSES = "courses";
const USERS = "users";

/** Only known keys leave the server. */
function clean(settings: StoredSettings | undefined, withLocks: boolean): StoredSettings {
  const values = Object.fromEntries(Object.entries(settings?.values ?? {}).filter(([k]) => isSettingKey(k)));
  return withLocks ? { values, locked: [...lockedKeys(settings)] } : { values };
}

export async function getSettingsOverview(user: AuthedUser): Promise<SettingsOverview> {
  const [{ memberships, orgs, courses }, userSnap] = await Promise.all([
    listViewableCourses(user.uid),
    adminDb().collection(USERS).doc(user.uid).get(),
  ]);
  const prefs = userSnap.get("prefs.selectedModels");
  return {
    profile: { email: user.email, selectedModels: Array.isArray(prefs) ? prefs : null },
    orgs: memberships
      .map((m) => {
        const org = orgs.get(m.orgId);
        return {
          id: m.orgId,
          name: (org?.get("name") as string | undefined) ?? "Organization",
          kind: m.orgKind,
          role: m.role,
          canManage: isOrgAdmin(m.role),
          settings: clean(org?.get("settings"), true),
        };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1)),
    courses: courses
      .map((c) => ({
        id: c.doc.id,
        orgId: c.doc.get("orgId") as string,
        name: c.doc.get("name") as string,
        archived: c.doc.get("archived") === true,
        canManage: c.access.manage,
        settings: clean(c.doc.get("settings"), false),
      }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name)),
  };
}

function applyPatch(current: StoredSettings | undefined, patch: ReturnType<typeof validateSettingsPatch>): StoredSettings {
  const values: Record<string, unknown> = { ...(current?.values ?? {}) };
  for (const key of patch.clear) delete values[key];
  Object.assign(values, patch.set);
  const next: StoredSettings = { ...current, values };
  if (patch.locked) next.locked = patch.locked;
  return next;
}

function toUserError(error: unknown): never {
  if (error instanceof UserFacingError) throw error;
  throw new UserFacingError(error instanceof Error ? error.message : "Invalid settings.");
}

export async function updateOrg(
  user: AuthedUser,
  orgId: string,
  change: { name?: string; settings?: SettingsPatch }
): Promise<void> {
  if (!isOrgAdmin(await getOrgRole(orgId, user.uid))) {
    throw new UserFacingError("Only owners and admins can change organization settings.");
  }
  const db = adminDb();
  const ref = db.collection(ORGS).doc(orgId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new UserFacingError("Organization not found.");
    const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = { updatedAt: new Date().toISOString() };
    if (change.name !== undefined) update.name = change.name;
    if (change.settings) {
      let patch;
      try {
        patch = validateSettingsPatch("org", change.settings);
      } catch (error) {
        toUserError(error);
      }
      update.settings = applyPatch(snap.get("settings"), patch);
    }
    tx.update(ref, update);
  });
}

export async function updateCourseSettings(user: AuthedUser, courseId: string, settings: SettingsPatch): Promise<void> {
  const { orgId } = await requireCourseAccess(user, courseId, "manage");
  const db = adminDb();
  const ref = db.collection(COURSES).doc(courseId);
  await db.runTransaction(async (tx) => {
    const [course, org] = await tx.getAll(ref, db.collection(ORGS).doc(orgId));
    let patch;
    try {
      patch = validateSettingsPatch("course", settings, lockedKeys(org.get("settings")));
    } catch (error) {
      toUserError(error);
    }
    tx.update(ref, { settings: applyPatch(course.get("settings"), patch), updatedAt: new Date().toISOString() });
  });
}

export async function updatePrefs(user: AuthedUser, prefs: { selectedModels: string[] }): Promise<void> {
  await adminDb()
    .collection(USERS)
    .doc(user.uid)
    .set({ prefs: { selectedModels: prefs.selectedModels }, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function getSelectedModelsPref(uid: string): Promise<string[] | null> {
  const prefs = (await adminDb().collection(USERS).doc(uid).get()).get("prefs.selectedModels");
  return Array.isArray(prefs) ? prefs : null;
}

/** Which delivery modes (online/paper) a course allows. Caller must have checked course access. */
export async function getDeliveryModes(orgId: string, courseId: string) {
  const db = adminDb();
  const [org, course] = await db.getAll(db.collection(ORGS).doc(orgId), db.collection(COURSES).doc(courseId));
  return resolveSetting("delivery.modes", org.get("settings") as StoredSettings | undefined, course.get("settings") as StoredSettings | undefined).value;
}

/** Settings that shape generation in a course. Caller must have checked course access. */
export async function getGenerationSettings(orgId: string, courseId: string) {
  const db = adminDb();
  const [org, course] = await db.getAll(db.collection(ORGS).doc(orgId), db.collection(COURSES).doc(courseId));
  const orgSettings = org.get("settings") as StoredSettings | undefined;
  const courseSettings = course.get("settings") as StoredSettings | undefined;
  return {
    defaultPoints: resolveSetting("questions.defaultPoints", orgSettings, courseSettings).value,
    allowedModels: resolveSetting("generation.allowedModels", orgSettings).value,
    instructions: [
      resolveSetting("generation.orgInstructions", orgSettings).value,
      resolveSetting("generation.courseInstructions", orgSettings, courseSettings).value,
    ].filter(Boolean),
  };
}
