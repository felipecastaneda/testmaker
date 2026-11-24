# Step 1 — Foundation: organizations, courses, settings

Status: proposal · Written 2026-11-24

## Goal

Turn TestMaker from "a list of tests owned by allow-listed users" into a multi-tenant app
that every later step can plug into:

- Every user belongs to one or more **organizations**. A solo professor gets a *personal*
  organization automatically; a school is an *institution* organization with members and roles.
- Tests live inside **courses**.
- A **layered settings system** (organization → course → later assignment) with admin locks,
  plus a Settings page.
- Questions get **points** and **tags**.
- **PDF and PPTX** upload.

Step 1 adds nothing for students, but it must not block anything that comes later
(assignments, student identity methods, paper mode, LMS).

### Out of scope for step 1

- Assignments, attempts, students, grading, gradebook (step 2)
- Question bank across tests and blueprint-based exam assembly (after step 2; tags added
  here make it possible)
- SSO, LTI, billing, sending invite emails
- New question types (multi-select, numeric, essay)

---

## Principles

1. **One code path.** "Individual professor" is an organization with `kind: "personal"` and a
   single owner. No `if (personal)` branches outside settings defaults and UI wording.
2. **The server stays the only gatekeeper.** Firestore and Storage rules keep denying all
   browser access. Every server action resolves `user → membership → role → resource`.
3. **Settings are data, defined once in a registry.** Future options (student identity, delivery
   mode, LMS) get registry entries when their feature ships. The UI never shows a switch that
   does nothing.
4. **Each PR ships on its own.** Every PR below leaves `main` deployable and the app working.

---

## Data model

### New collections

```
users/{uid}
  email, displayName, createdAt
  defaultOrgId                     // org opened after sign-in
  prefs: { selectedModels: string[] }

orgs/{orgId}
  name, kind: "personal" | "institution"
  createdBy, createdAt, updatedAt
  settings: { values: {...}, locked: string[] }   // see "Settings"

orgs/{orgId}/members/{uid}
  uid, email, role: "owner" | "admin" | "instructor" | "assistant"
  joinedAt, invitedBy

orgs/{orgId}/invites/{inviteId}    // inviteId = random 32-byte token (base64url)
  email, role, createdBy, createdAt, expiresAt, acceptedAt?, acceptedBy?

courses/{courseId}
  orgId, name, code?, term?, archived: boolean
  staff: { [uid]: "instructor" | "assistant" }    // map, so one doc read answers "may X see this?"
  staffUids: string[]                              // same uids, for array-contains queries
  settings: { values: {...} }
  createdBy, createdAt, updatedAt

_meta/platform
  signupMode: "allowlist" | "open"
  allowedEmails: string[]          // used when signupMode = "allowlist"
```

`members` is a subcollection, so "which orgs am I in?" uses a collection-group query on
`members` where `uid == me`, with one index.

### Changes to existing collections

```
tests/{testId}
  + orgId, courseId
  ~ ownerId  → kept and renamed in meaning to "createdBy" (keep the field name; no rewrite needed)
  nameKey uniqueness moves from per-owner to per-course

tests/{testId}/questions/{id}   (and versions/v{n}/questions/{id})
  + points?: number               // default 1 when missing
  + tags?: string[]               // lower-cased, trimmed, max 20 per question, max 40 chars each

usage/{uid}_{day}                 // unchanged: daily quota stays per user
usage_org/{orgId}_{day}           // new: optional organization-wide cap
```

`tests` stays a top-level collection, so the migration doesn't move any question
documents. It only adds fields.

### Types (`src/lib/types.ts`)

```ts
export type OrgKind = "personal" | "institution";
export type OrgRole = "owner" | "admin" | "instructor" | "assistant";
export type CourseRole = "instructor" | "assistant";

export interface OrgSummary { id: string; name: string; kind: OrgKind; role: OrgRole }
export interface CourseSummary {
  id: string; orgId: string; name: string; code?: string; term?: string;
  archived: boolean; myRole: CourseRole | "admin"; testCount: number;
}
// QuestionData gains:  points?: number;  tags?: string[];
// TestSummary gains:   courseId: string;
```

---

## Access control

### Permissions

| Action | owner | admin | instructor | assistant |
|---|---|---|---|---|
| Edit org name, org settings, locks | ✓ | ✓ | | |
| Invite / remove members, change roles | ✓ | ✓ (not owners) | | |
| Delete org, transfer ownership | ✓ | | | |
| Create course | ✓ | ✓ | ✓ (if `courses.instructorsCanCreate`) | |
| See every course in org | ✓ | ✓ | | |
| Course settings, add/remove course staff | ✓ | ✓ | course instructor | |
| Create / edit / delete tests in a course | ✓ | ✓ | course instructor | course assistant¹ |
| View tests in a course | ✓ | ✓ | course staff | course staff |

¹ Controlled by the course setting `assistants.canEdit` (default: false).

In a personal org the single owner can do everything, so the table needs no special case.

### Server code

Replace `requireUser` with three layers in `src/server/auth.ts` / new `src/server/access.ts`:

```ts
requireUser(idToken)                       // token valid + email verified + signup gate
requireOrgMember(user, orgId, minRole?)    // reads orgs/{orgId}/members/{uid}
requireCourseAccess(user, courseId, need: "view" | "edit" | "manage")
                                           // reads course, then membership; admins bypass staff map
```

`getOwnedTestRef(ownerId, testId)` becomes `getTestRef(user, testId, need)`. It loads the
test, then calls `requireCourseAccess(user, test.courseId, need)`. The "Test not found"
message stays the same for missing and forbidden tests, so test ids can't be probed.

Every action in `src/app/actions/tests.ts` changes from `user.uid` to a `user` context.
`saveTest` gets a required `courseId`.

### Signup gate (replaces `ALLOWED_EMAILS`)

`requireUser` passes if **any** of these is true:
- `_meta/platform.signupMode === "open"`
- email is in `_meta/platform.allowedEmails`
- email is in the `ALLOWED_EMAILS` env var (kept as a bootstrap, so nothing breaks on deploy)
- the user already belongs to at least one org (i.e. they accepted an invite)

That last rule lets institutions invite people without the platform owner adding each
email. `PLATFORM_ADMIN_EMAILS` (new App Hosting secret) lists who may edit `_meta/platform`
from a "Platform" tab in Settings.

### Invites

- An admin creates an invite, and the UI shows a copyable link `/invite/{token}`. Sending
  email comes later (Firebase "Trigger Email" extension or Resend).
- Accepting requires signing in with a **verified email that matches** the invite. The
  membership is written and the invite marked accepted in one transaction.
- Invites expire after 14 days, can be revoked, and can only be used once.

---

## Settings

### Registry (`src/lib/settings/registry.ts`, shared by client and server)

```ts
type Scope = "org" | "course";            // "assignment" is added in step 2
interface SettingDef<T> {
  key: string;                            // "generation.defaultDifficulty"
  label: string; help: string;
  schema: z.ZodType<T>;
  default: T | ((org: { kind: OrgKind }) => T);   // defaults may differ for personal vs institution
  scopes: Scope[];                        // where it can be set
  lockable: boolean;                      // may an org admin lock it for courses?
  group: "general" | "generation" | "questions" | "members" | "courses";
}
```

Resolution (`resolveSettings(def, org, course?)`):
`registry default → org value → course value (ignored if the org has locked the key)`.
Unit-tested in isolation.

Storage: `orgs/{id}.settings = { values, locked }`, `courses/{id}.settings = { values }`.
Writes are validated against `def.schema`. Unknown keys are rejected.

### Settings that ship in step 1

| Key | Scopes | Default | Lockable |
|---|---|---|---|
| `org.kind` (shown as "Individual / Institution") | org | — | — |
| `generation.allowedModels` | org | all configured | ✓ |
| `generation.defaultDifficulty` | org, course | `mixed` | |
| `generation.instructions` (prepended to every prompt) | org, course | `""` | |
| `generation.dailyLimitPerMember` | org | 300 | ✓ |
| `generation.dailyLimitOrg` | org | off (personal), 3000 (institution) | ✓ |
| `questions.defaultPoints` | org, course | 1 | |
| `courses.instructorsCanCreate` | org | true | ✓ |
| `assistants.canEdit` | org, course | false | ✓ |

The answers you gave (student identity, online/paper, standalone/LMS) become registry
entries in the steps that implement them, for example `students.identityMethods` in step 2,
`delivery.modes` in step 3, and `lms.*` in step 6. The registry and resolution are built so
those entries can be added without schema changes.

### Pages

The app is a single page today, with step state in `src/app/page.tsx`. Step 1 adds real routes:

```
/                     generate + library (existing flow; library grouped by course)
/settings             tabs: Profile · Organization · Members · Courses · Platform*
/settings/courses/[id] course details, staff, course-level settings
/invite/[token]       accept invite
```

\* Platform tab is visible only to `PLATFORM_ADMIN_EMAILS`.

Settings UI rules: an org-locked setting shows as read-only on the course page with
"Set by your organization". Personal orgs hide Members, locks and the
Individual/Institution distinction until the owner switches to "Institution".

Navbar gets an **org switcher** (hidden when the user has exactly one org) and a Settings
link. The model picker moves into user prefs (`users/{uid}.prefs.selectedModels`), and only
models in `generation.allowedModels` can be chosen.

---

## Questions: points and tags

- `QuestionSchema` in `src/app/actions/tests.ts`: `points: z.number().min(0).max(100).multipleOf(0.5).optional()`,
  `tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional()`.
- `toStored` / `fromStored` in `tests-repo.ts` pass the new fields through.
- `QuestionCard` edit mode: points input + tag chips. Preview header shows total points.
- Exporters: print/docx show "(2 pts)" per question and the total. GIFT supports weights
  via `%` only per answer, so points are left out there (documented).
- Generation: the prompt also returns 1–3 topic tags per question (`generate-question-set.ts`
  output schema + `normalize.ts`). New questions get `questions.defaultPoints`.

## Answer-key separation (groundwork for step 2)

There are no students yet, but the projection is added and tested now:

- `src/server/projections.ts` → `toStudentQuestion(q)` strips `correctAnswer`,
  `explanation`, `sourceQuote`, `sourceModel`, and merges and shuffles the options with a seeded
  shuffle.
- A unit test confirms no answer-revealing field survives. "Take test" preview stays as is
  (professors only).

## PDF and PPTX import (`src/lib/document-parser.ts`)

- **PPTX**: reuses the existing ZIP reader. Read `ppt/slides/slideN.xml` in numeric order and
  collect `<a:t>` text per paragraph. Also read `ppt/notesSlides/notesSlideN.xml` (speaker
  notes often hold the real content). Output `--- Slide N ---` headings so source quotes
  stay locatable.
- **PDF**: `pdfjs-dist`, **loaded on demand** only when a PDF is picked, with the worker
  served from `/public`. Page text is joined with `--- Page N ---` markers. If fewer than about
  100 characters come out of a multi-page PDF, show "This PDF looks scanned (images only).
  Text recognition isn't supported yet". OCR or vision comes in a later step.
- Both keep the existing 400k-character cap. `SUPPORTED_EXTENSIONS` and the uploader's
  `accept` attribute get the new extensions.
- Tests: small fixture `.pptx` and `.pdf` files in `tests/fixtures/`.

---

## Migration

The script is idempotent and safe to re-run. It runs **before** the code that requires
`orgId` and `courseId` is deployed.

1. Back up: `gcloud firestore export gs://<bucket>/backups/pre-step1`.
2. `scripts/migrate-step1.ts` (run with `npx tsx`, ADC credentials, `--dry-run` by default):
   - For every distinct `tests.ownerId`: create `users/{uid}`, a personal org
     ("<email>'s workspace"), owner membership, and one course "My tests".
   - Set `orgId` and `courseId` on each of that user's tests, and recompute `nameKey`
     uniqueness per course (no conflicts are possible, since names were already unique per
     owner).
   - Seed `_meta/platform` with `signupMode: "allowlist"` and the current `ALLOWED_EMAILS`.
   - Print a summary: users, orgs, courses and tests touched.
3. A lazy fallback, `ensurePersonalOrg(user)`, also runs on sign-in. It covers users who sign
   up later and any test the script missed (a test without `orgId` is adopted on its
   owner's next sign-in).
4. `migrateLegacyTests` / `LEGACY_OWNER_EMAIL` can be removed after this step. The `_meta`
   marker shows it has already run.

Rollback: the migration only **adds** fields and documents, so the previous deploy keeps
working against migrated data. Roll back the code, and the extra fields are ignored.

---

## Indexes (`firestore.indexes.json`)

- `tests`: `courseId ASC, updatedAt DESC`
- `tests`: `courseId ASC, nameKey ASC`
- `courses`: `orgId ASC, archived ASC, name ASC`
- `courses`: `staffUids ARRAY_CONTAINS, archived ASC`
- collection group `members`: `uid ASC` (field override, collection-group scope)

`firestore.rules` and `storage.rules`: **unchanged** (deny all).

---

## Testing

**Unit (Vitest)**
- Settings resolution: default, org, course, locked, personal vs institution defaults, rejecting unknown keys.
- Permission matrix: one table-driven test per row of the table above.
- `toStudentQuestion` never leaks answer fields.
- PPTX/PDF extraction against fixtures; scanned-PDF detection.
- Migration on emulator data: running twice gives the same result.

**E2E (Playwright + emulators)**
- New signup → personal org and "My tests" course exist → generate and save test into it.
- Create institution org → invite link → second user accepts → sees only courses they're staff on.
- Second user cannot load a test from another course by id (gets "Test not found").
- Admin locks `generation.allowedModels` → course page shows it read-only → navbar hides the locked-out model.
- Upload a PPTX and a PDF → questions generate with slide/page markers in quotes.

---

## Delivery: PRs in order

| PR | Content | Size |
|---|---|---|
| 1 | Types, `users`/`orgs`/`members`, `access.ts`, migration script + lazy `ensurePersonalOrg`, signup gate. UI unchanged (everyone lands in their personal org). | L |
| 2 | Courses: CRUD, staff, tests scoped to courses, library grouped by course, course picker in save dialog, indexes. | M |
| 3 | Settings registry + resolution, `/settings` page (Profile, Organization, Courses), org switcher, model prefs move server-side. | L |
| 4 | Members & invites (`/invite/[token]`), roles UI, Platform tab. | M |
| 5 | Points & tags (schema, editor, exports, AI tags). Student projection + test. | S |
| 6 | PDF & PPTX import. | S–M |

PRs 5 and 6 are independent of 2–4 and can ship any time after PR 1. If you want something
visible to professors quickly, PR 6 can even go first.

---

## Open questions

1. **Public signup.** Keep `allowlist` mode at launch and invite professors, or go `open` with a
   low default daily quota? (Affects AI cost exposure.)
2. **Invite email sending.** Links shared by hand are fine for a pilot. Pick a provider when
   institutions arrive.
3. **Can one person be in several institutions?** The model supports it. The UI only needs the
   org switcher. Recommended: yes.
4. **Data residency / privacy.** No student data exists in step 1, but before step 2 decide the
   Firestore region and write a privacy notice (FERPA, GDPR, Colombia's Ley 1581, depending
   on where schools are).
5. **`apphosting.yaml` `maxInstances: 1`.** Fine for step 1. Needs raising before step 2
   (a whole class starting an exam at once).
