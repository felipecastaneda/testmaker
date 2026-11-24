import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import { isPlatformAdmin, type AuthedUser } from "./auth";
import { UserFacingError } from "./errors";
import { getPlatformConfig } from "./platform";
import { courseRoleOf, getOrgRole, listMemberships, personalOrgId, requireCourseAccess, type Membership } from "./workspace";
import { canChangeMember, isOrgAdmin } from "@/lib/permissions";
import type { CourseRole, InviteInfo, MemberSummary, OrgMembersView, OrgRole, CourseStaffView } from "@/lib/types";

/*
 * Data model
 *   invites/{sha256(token)}   { orgId, orgName, email, role, createdBy, createdAt, expiresAt,
 *                               acceptedAt?, acceptedBy?, revokedAt? }
 * The token only exists in the invite link; Firestore stores its hash, so reading the
 * database doesn't reveal working links.
 */

const ORGS = "orgs";
const MEMBERS = "members";
const COURSES = "courses";
const USERS = "users";
const INVITES = "invites";
const INVITE_DAYS = 14;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function orgRef(orgId: string) {
  return adminDb().collection(ORGS).doc(orgId);
}

async function requireOrgAdmin(user: AuthedUser, orgId: string): Promise<OrgRole> {
  const role = await getOrgRole(orgId, user.uid);
  if (!isOrgAdmin(role)) throw new UserFacingError("Only owners and admins can manage members.");
  return role!;
}

async function requireInstitution(orgId: string): Promise<FirebaseFirestore.DocumentSnapshot> {
  const snap = await orgRef(orgId).get();
  if (!snap.exists) throw new UserFacingError("Organization not found.");
  if (snap.get("kind") !== "institution") {
    throw new UserFacingError("Personal workspaces have a single member. Create an institution to invite people.");
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Institutions and the active organization
// ---------------------------------------------------------------------------

/** Platform admins can always create institutions; anyone can once signup is open. */
export async function canCreateInstitutions(user: AuthedUser): Promise<boolean> {
  return isPlatformAdmin(user) || (await getPlatformConfig()).signupMode === "open";
}

export async function createInstitution(user: AuthedUser, name: string): Promise<string> {
  if (!(await canCreateInstitutions(user))) throw new UserFacingError("You can't create institutions.");
  const db = adminDb();
  const ref = db.collection(ORGS).doc();
  const now = new Date().toISOString();
  const batch = db.batch();
  batch.create(ref, { name, kind: "institution", createdBy: user.uid, createdAt: now, updatedAt: now, settings: { values: {}, locked: [] } });
  batch.create(ref.collection(MEMBERS).doc(user.uid), {
    uid: user.uid,
    email: user.email,
    orgId: ref.id,
    orgKind: "institution",
    role: "owner",
    joinedAt: now,
  });
  batch.set(db.collection(USERS).doc(user.uid), { defaultOrgId: ref.id, updatedAt: now }, { merge: true });
  await batch.commit();
  return ref.id;
}

/** The org the user last chose, if they still belong to it; otherwise their personal one. */
export async function getActiveOrgId(uid: string, memberships?: Membership[]): Promise<string> {
  memberships ??= await listMemberships(uid);
  const chosen = (await adminDb().collection(USERS).doc(uid).get()).get("defaultOrgId");
  return memberships.some((m) => m.orgId === chosen) ? chosen : personalOrgId(uid);
}

export async function setActiveOrg(user: AuthedUser, orgId: string): Promise<void> {
  if (!(await getOrgRole(orgId, user.uid))) throw new UserFacingError("Organization not found.");
  await adminDb().collection(USERS).doc(user.uid).set({ defaultOrgId: orgId, updatedAt: new Date().toISOString() }, { merge: true });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function listOrgMembers(orgId: string): Promise<MemberSummary[]> {
  const snap = await orgRef(orgId).collection(MEMBERS).get();
  return snap.docs
    .map((d) => ({ uid: d.id, email: d.get("email") as string, role: d.get("role") as OrgRole, joinedAt: d.get("joinedAt") as string }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function getOrgMembers(user: AuthedUser, orgId: string): Promise<OrgMembersView> {
  const myRole = await requireOrgAdmin(user, orgId);
  await requireInstitution(orgId);
  const [members, invites] = await Promise.all([
    listOrgMembers(orgId),
    adminDb().collection(INVITES).where("orgId", "==", orgId).get(),
  ]);
  const now = new Date().toISOString();
  return {
    myRole,
    members,
    invites: invites.docs
      .filter((d) => !d.get("acceptedAt") && !d.get("revokedAt") && d.get("expiresAt") > now)
      .map((d) => ({ id: d.id, email: d.get("email"), role: d.get("role"), expiresAt: d.get("expiresAt") }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}

async function countOwners(orgId: string): Promise<number> {
  return (await orgRef(orgId).collection(MEMBERS).where("role", "==", "owner").count().get()).data().count;
}

export async function updateMemberRole(user: AuthedUser, orgId: string, uid: string, role: OrgRole): Promise<void> {
  const actor = await requireOrgAdmin(user, orgId);
  await requireInstitution(orgId);
  const current = await getOrgRole(orgId, uid);
  if (!current) throw new UserFacingError("That person isn't a member any more.");
  if (!canChangeMember(actor, current, role)) throw new UserFacingError("Only owners can change an owner's role or make someone an owner.");
  if (current === "owner" && role !== "owner" && (await countOwners(orgId)) <= 1) {
    throw new UserFacingError("An organization needs at least one owner. Make someone else an owner first.");
  }
  await orgRef(orgId).collection(MEMBERS).doc(uid).update({ role });
}

/** Remove a member (or leave, when `uid` is the user's own). Also drops them from course staff. */
export async function removeMember(user: AuthedUser, orgId: string, uid: string): Promise<void> {
  const leaving = uid === user.uid;
  const actor = await getOrgRole(orgId, user.uid);
  if (!actor) throw new UserFacingError("Organization not found.");
  await requireInstitution(orgId);
  const current = await getOrgRole(orgId, uid);
  if (!current) return;
  if (!leaving && !canChangeMember(actor, current, null)) {
    throw new UserFacingError(isOrgAdmin(actor) ? "Only owners can remove an owner." : "Only owners and admins can remove members.");
  }
  if (current === "owner" && (await countOwners(orgId)) <= 1) {
    throw new UserFacingError("An organization needs at least one owner. Make someone else an owner first.");
  }

  const db = adminDb();
  const staffOf = await db.collection(COURSES).where("staffUids", "array-contains", uid).get();
  const writer = db.bulkWriter();
  for (const course of staffOf.docs.filter((c) => c.get("orgId") === orgId)) {
    writer.update(course.ref, new FieldPath("staff", uid), FieldValue.delete(), "staffUids", FieldValue.arrayRemove(uid));
  }
  writer.delete(orgRef(orgId).collection(MEMBERS).doc(uid));
  await writer.close();
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function createInvite(
  user: AuthedUser,
  orgId: string,
  email: string,
  role: OrgRole
): Promise<{ token: string; expiresAt: string }> {
  const actor = await requireOrgAdmin(user, orgId);
  const org = await requireInstitution(orgId);
  if (!canChangeMember(actor, null, role)) throw new UserFacingError("Only owners can invite owners.");
  const existing = await orgRef(orgId).collection(MEMBERS).where("email", "==", email).limit(1).get();
  if (!existing.empty) throw new UserFacingError(`${email} is already a member.`);

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  await adminDb().collection(INVITES).doc(hashToken(token)).create({
    orgId,
    orgName: org.get("name"),
    email,
    role,
    createdBy: user.uid,
    createdAt: now.toISOString(),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function revokeInvite(user: AuthedUser, orgId: string, inviteId: string): Promise<void> {
  await requireOrgAdmin(user, orgId);
  const ref = adminDb().collection(INVITES).doc(inviteId);
  const snap = await ref.get();
  if (!snap.exists || snap.get("orgId") !== orgId) throw new UserFacingError("Invite not found.");
  if (!snap.get("acceptedAt")) await ref.update({ revokedAt: new Date().toISOString() });
}

function inviteStatus(snap: FirebaseFirestore.DocumentSnapshot): InviteInfo["status"] {
  if (!snap.exists) return "not_found";
  if (snap.get("acceptedAt")) return "used";
  if (snap.get("revokedAt")) return "revoked";
  if (snap.get("expiresAt") <= new Date().toISOString()) return "expired";
  return "valid";
}

const INVITE_PROBLEMS: Record<Exclude<InviteInfo["status"], "valid">, string> = {
  not_found: "This invite link isn't valid. Ask for a new one.",
  used: "This invite has already been used.",
  revoked: "This invite was cancelled. Ask for a new one.",
  expired: "This invite has expired. Ask for a new one.",
};

/** What the invite page shows. Works before the user has access to the app. */
export async function getInvite(user: AuthedUser, token: string): Promise<InviteInfo> {
  const snap = await adminDb().collection(INVITES).doc(hashToken(token)).get();
  const status = inviteStatus(snap);
  if (status !== "valid") return { status, message: INVITE_PROBLEMS[status] };
  return {
    status,
    orgName: snap.get("orgName"),
    role: snap.get("role"),
    email: snap.get("email"),
    emailMatches: snap.get("email") === user.email,
  };
}

export async function acceptInvite(user: AuthedUser, token: string): Promise<{ orgId: string }> {
  const db = adminDb();
  const inviteRef = db.collection(INVITES).doc(hashToken(token));
  return db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef);
    const status = inviteStatus(invite);
    if (status !== "valid") throw new UserFacingError(INVITE_PROBLEMS[status]);
    if (invite.get("email") !== user.email) {
      throw new UserFacingError(`This invite is for ${invite.get("email")}. Sign in with that email to accept it.`);
    }
    const orgId: string = invite.get("orgId");
    const [org, member] = await tx.getAll(orgRef(orgId), orgRef(orgId).collection(MEMBERS).doc(user.uid));
    if (!org.exists) throw new UserFacingError("That organization no longer exists.");
    const now = new Date().toISOString();
    // Already a member: keep their current role rather than silently changing it.
    if (!member.exists) {
      tx.create(member.ref, { uid: user.uid, email: user.email, orgId, orgKind: org.get("kind"), role: invite.get("role"), joinedAt: now, invitedBy: invite.get("createdBy") });
    }
    tx.update(inviteRef, { acceptedAt: now, acceptedBy: user.uid });
    tx.set(db.collection(USERS).doc(user.uid), { defaultOrgId: orgId, updatedAt: now }, { merge: true });
    return { orgId };
  });
}

// ---------------------------------------------------------------------------
// Course staff
// ---------------------------------------------------------------------------

export async function getCourseStaff(user: AuthedUser, courseId: string): Promise<CourseStaffView> {
  const { orgId } = await requireCourseAccess(user, courseId, "manage");
  const [course, members] = await Promise.all([adminDb().collection(COURSES).doc(courseId).get(), listOrgMembers(orgId)]);
  const staff = members
    .map((m) => ({ uid: m.uid, email: m.email, role: courseRoleOf(course.data(), m.uid) }))
    .filter((m): m is { uid: string; email: string; role: CourseRole } => m.role !== null);
  return {
    staff,
    candidates: members.filter((m) => !staff.some((s) => s.uid === m.uid)).map((m) => ({ uid: m.uid, email: m.email })),
  };
}

/** Add, change or (with `role` null) remove someone on the course's staff. */
export async function setCourseStaff(user: AuthedUser, courseId: string, uid: string, role: CourseRole | null): Promise<void> {
  const { orgId } = await requireCourseAccess(user, courseId, "manage");
  if (role && !(await getOrgRole(orgId, uid))) throw new UserFacingError("Only members of the organization can join a course.");
  const ref = adminDb().collection(COURSES).doc(courseId);
  const now = new Date().toISOString();
  if (role) {
    await ref.update(new FieldPath("staff", uid), role, "staffUids", FieldValue.arrayUnion(uid), "updatedAt", now);
  } else {
    await ref.update(new FieldPath("staff", uid), FieldValue.delete(), "staffUids", FieldValue.arrayRemove(uid), "updatedAt", now);
  }
}
