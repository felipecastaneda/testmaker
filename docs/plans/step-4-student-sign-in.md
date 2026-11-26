# Step 4: Student sign-in (Google, school SSO)

Status: part 1 built (2026-11-26) · Written 2026-11-26 · Builds on step 2 (online exams) and step 1 (settings)

## Goal

Today a student joins an online exam by typing a name and a student ID. That's quick, but anyone
can type someone else's ID, and an attempt lives only on the device where it started. Step 4 lets a
course require students to **sign in with their school account** instead:

1. **Google** (Google Workspace for Education, or any Google account)
2. **School SSO** (the school's own SAML or OpenID Connect login)

Which one applies is a **setting** (organization, course, and per assignment), as decided in the
original plan. Name + student ID stays available and stays the default.

### Out of scope for step 4

Professors signing in with Google/SSO (they keep email + password for now), rosters synced from
an LMS (step 6), proctoring.

---

## Principles

1. **One identity per attempt, from the sign-in provider.** With sign-in, "one attempt per
   student" means one per account (Firebase uid), not per typed ID. Nobody can start an attempt in
   someone else's name.
2. **Students never become professors.** Student accounts live in the same Firebase Auth project,
   but they don't pass the professor signup gate (allow-list / institution membership), so they
   can't see any professor page or data. Student actions keep using the attempt token after joining.
3. **Schools decide who can join.** Each organization lists its **allowed email domains**
   (e.g. `school.edu`); the server checks the verified email's domain on every join.
4. **Resume anywhere.** Signing in again on another device resumes the same attempt (the old
   device's session ends). This removes most "I switched laptops" resets.
5. **Minimal data.** We keep the uid, verified email and display name from the provider, plus the
   student ID if the course asks for it. Nothing else from the account.

---

## Settings (registry)

| Key | Scopes | Values | Default |
|---|---|---|---|
| `students.identity` | org, course (lockable) | `name_and_id`, `google`, `sso` | `name_and_id` |
| `students.allowedDomains` | org | list of domains; empty = any account of that provider | empty |
| `students.askStudentId` | org, course | also ask for the student ID after sign-in (for CSV / LMS matching) | on |

The Assign dialog shows the course's identity method and lets the professor change it for one
assignment (unless the org locked it). Stored on the assignment as `identity`.

---

## Data model (additions)

```
assignments/{id}
  identity: "name_and_id" | "google" | "sso"
  allowedDomains: [...]                 // snapshot at creation (changing org settings later doesn't
                                        // lock students out mid-exam)
assignments/{id}/attempts/{attemptId}
  attemptId = sha256(assignmentId + ":uid:" + uid)     // for signed-in students
  uid, email, provider                  // new, for signed-in students
  studentName (from the provider), studentId (typed, optional), studentKey = "uid:" + uid
```

Gradebook and CSV gain an **Email** column for signed-in students.

---

## Student flow (signed in)

1. `/take/{code}` shows "Sign in with Google" (or "Sign in with {School}") instead of the name/ID
   form. Firebase Auth signs in with a popup (`hd` / `tenant` hints limit the account picker to the
   school when one domain is configured).
2. The browser sends the Firebase ID token to `joinAssignment`. The server verifies it, checks
   `email_verified`, the provider, and the allowed domains, then creates or **resumes** the attempt
   for that uid and returns a fresh attempt token (the previous token stops working).
3. Everything after that is unchanged: autosave, deadline, submit, results.

Errors students can understand: "Sign in with your school.edu account", "This exam needs a school
account; personal Gmail isn't accepted", "Pop-up blocked: allow pop-ups and try again".

---

## Setup the project needs (one-time, outside the code)

| What | Why | Who |
|---|---|---|
| Add `testmaker--testmaker-3fa6b.us-east4.hosted.app` to Firebase Auth **authorized domains** | Sign-in pop-ups only work from authorized domains (today: localhost, firebaseapp.com, web.app) | I can do it with the Identity Toolkit API, with your OK |
| Google provider | Already enabled on the project | — |

| School SSO: **upgrade Firebase Auth to Identity Platform** | SAML / OIDC providers need it. Free for the first 50 SSO users a month, then about $0.015 per monthly active SSO user | You decide; needs billing |
| Each school's SSO: its IdP metadata (SAML) or issuer + client ID (OIDC) | Registered per institution from Settings | The school's IT + an institution owner |

---

## Delivery: two parts (one PR each)

| Part | Content |
|---|---|
| 1 | Settings (`students.identity`, `allowedDomains`, `askStudentId`), assignment `identity`, **Google sign-in** for students (domain check, resume on another device), gradebook/CSV email. e2e with the Auth emulator's Google sign-in. Authorized domain added. |
| 2 | **School SSO**: institution owners register a SAML or OIDC provider in Settings → Organization (Identity Platform), students pick "Sign in with {School}". Needs the Identity Platform upgrade first (your decision, billing). |

---

## Decisions (2026-11-26)

1. **Providers:** Google and school SSO (SAML/OIDC). **No Microsoft** for now (it can be added later
   on the same code path).
2. **No allowed domains = any Google account** (good for individual professors). Institutions
   restrict sign-in by listing their domains.
3. **Student ID after sign-in:** asked by default, as a setting (`students.askStudentId`).
4. **Authorized domain: done.** `testmaker--testmaker-3fa6b.us-east4.hosted.app` was added to
   Firebase Auth's authorized domains.
5. **Identity Platform upgrade** (needed for part 2, SSO) is still to be decided before part 2.
