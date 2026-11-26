# Step 3: Paper exams (print, scan or type answers, grade)

Status: parts 1–3 built (2026-11-26) · Written 2026-11-25 · Builds on step 2 (assignments, grading, gradebook)

## Goal

A professor whose students have no devices can give the same exam on paper and get the same
gradebook:

1. **Print:** turn a test into a *paper assignment*, print up to four versions (A–D) of the
   question booklet, one **answer sheet** per student (bubbles), and the answer keys.
2. **Collect answers:** either **scan** the filled sheets (phone photos or a scanner PDF; read in
   the browser) or **type** them in quickly (e.g. `ABDCA…`).
3. **Grade:** the same server grading, gradebook, regrade, CSV and item analysis as online exams.

### Out of scope for step 3

Handwritten / open answers and any AI reading of sheets (step 5), live camera capture,
pre-printed personalised sheets from a roster, Google/SSO (step 4), LTI (step 6).

---

## Principles

1. **Paper is just another way to create attempts.** A paper attempt is an attempt with
   `source: "paper"` and a `variant`. Grading, gradebook, regrade, CSV and the counts don't change.
2. **The assignment snapshot is the source of truth.** Versions are built deterministically from the
   frozen questions with a per-assignment seed, so a reprint months later is identical and editing
   the test never changes a printed key.
3. **Sheets are read in the browser, not by an AI model.** The bubbles are read on the
   professor's computer. The server receives what was read (student ID, version, answers) plus a
   downscaled image of the sheet, which is **kept with the attempt** so the professor can show it
   if a student disputes a grade. (Consistent with step 2: student data is never sent to an AI
   model.)
4. **The professor confirms every sheet.** The scanner flags anything uncertain (blank, two marks,
   faint mark, unreadable ID) and the professor fixes it on a review screen before saving. Nothing
   is graded silently.

---

## Data model (additions)

```
assignments/{id}
  delivery: "online" | "paper"           // new; existing assignments are "online"
  paper?: {
    versions: 1..4                        // A–D
    idLength: 4..12                       // student-ID bubble columns on the sheet
    idCharset: "digits" | "letters_digits" // letters+digits = 36 bubbles per column
    seed                                  // random, set at creation; drives version order
  }
  // online-only options (window, time limit, join code, results policy, max students)
  // are hidden and ignored for paper assignments; no join code is created.

assignments/{id}/attempts/{attemptId}     // same doc as step 2, plus:
  source: "online" | "paper"              // missing = "online"
  variant?: "A" | "B" | "C" | "D"
  entry?: "scan" | "typed"
  scan?: { path, width, height, marks }   // stored sheet image + where each bubble was read
  // no tokenHash, deadline or order for paper; submittedAt = when it was saved,
  // submittedBy: "teacher"

Cloud Storage (server-only, rules stay deny-all):
  paper-scans/{assignmentId}/{attemptId}.jpg   // ~1600 px JPEG, ~200–400 KB
```

Scan images are uploaded through a server action (one sheet per call, size-checked), shown to
professors through short-lived signed URLs, and deleted when the attempt is deleted or replaced,
or the assignment is deleted. They stay in the project's US bucket.

`attemptId` stays `sha256(assignmentId:studentKey)`, so one attempt per student ID still holds.
Saving a sheet for an ID that already has one asks *Replace?* (a re-scan or a correction).

Versions use `buildVariants` (already used by Print/Word) with the seed added, so A keeps the
snapshot order and B–D shuffle questions and options. The server rebuilds the variant to turn a
letter into the option text before grading, so `answers` are stored exactly like online attempts
and regrades work unchanged.

New setting (registry): **`delivery.modes`** (org and course, lockable): which of *Online* and
*Paper* professors can use. Default both. This is the Settings switch from the original plan.

---

## The answer sheet

One A4/Letter page (prints correctly on both), generated as HTML and printed to PDF like today's
export:

```
 ■                                                         ■
   Exam title · Course · Version B    |||| code strip ||||
   Name: _______________________
   STUDENT ID  [_][_][_][_][_][_]     1  ○A ○B ○C ○D ○E   26 ○A ...   51 ○A ...
               (write, then bubble)   2  ○A ○B ○C ○D ○E   27 ...
     A ○ ○ ○ ○ ○ ○                    ...
     B ○ ○ ○ ○ ○ ○
     ...  Z, then 0–9 (one column per character)
 ■                                                         ■
```

- Four solid corner squares let the scanner find and straighten the page (photo at an angle,
  scanner skew).
- A printed binary strip encodes the version and a short checksum of the assignment, so a sheet
  from another exam (or the wrong version) is caught. No QR code and no new dependency.
- **Student IDs with letters:** each ID column has A–Z and 0–9 (36 bubbles). Students write
  their ID in the boxes, then fill one bubble per column. Exams whose IDs are digits only can
  choose *Digits only* (10 bubbles per column), which leaves more room for questions. The
  professor sets the number of columns (4–12); shorter IDs leave the rest blank.
- Up to **75 questions** with a letters+digits ID grid, **100** with digits only, and **5
  options (A–E)**. True/false uses A/B. A test with more questions or options can't be assigned
  on paper (clear message when assigning).
- One layout that prints correctly on **both Letter and A4** (the intersection of the two
  pages, with margins for printers that shrink to fit). The scanner doesn't depend on paper size
  because it locates the corner squares.
- Students write their name and fill in their ID and answers with a dark pen or pencil. Sheets
  are printed per version, so the version is pre-printed in the code strip; there's nothing for
  the student to mark.

The question booklets say "Mark your answers on the answer sheet", show the version letter on
every page, and have no answer lines.

---

## Reading scans (in the browser)

1. The professor opens the paper assignment → **Add answers → Scan sheets** and drops photos
   (JPG/PNG/HEIC where the browser supports it) or a multi-page scanner PDF (pdf.js, already
   used for uploads, renders each page).
2. For each image: grayscale → threshold → find the four corner squares → perspective-correct to
   the known layout → read the code strip → measure how dark each bubble is relative to the
   sheet's own paper/ink levels.
3. A bubble counts as filled when it's clearly darker than the others in its row; a row with
   two clear marks is *multiple*, one with only a faint mark is *uncertain*, none is *blank*.
4. Plain TypeScript on `<canvas>`, no OpenCV. Runs on the page one sheet at a time (a fraction of a
   second each), yielding between sheets so the tab stays responsive. Unit tests run it on synthetic
   sheets (rotated, skewed, blurred, uneven light).

**Review screen:** one row per sheet with the student ID, version, score preview and flags; open
a sheet to see the photo with the detected marks drawn on it and fix any answer or the ID by
clicking. *Save all* sends `{ studentId, name?, variant, letters[] }` per sheet; the server
validates, maps letters to options, grades and writes the attempts in batches.

The name isn't machine-readable. It's taken from the ID the next time the same student appears
(online or paper) or typed on the review screen; the gradebook shows the ID when there's no name.

## Typing answers

**Add answers → Type answers:** a fast keyboard form per student: student ID, name (optional),
version, then the answers as a string (`ABDCA BC-DA…`; `-` or space = blank), with live count
and score preview. Enter saves and clears for the next student. Useful for a few sheets, or when
there's no scanner.

## Professor flow changes

- **Assign dialog:** *Online* / *Paper* choice (only the modes allowed by `delivery.modes`). Paper
  asks for number of versions and student-ID digits.
- **Paper assignment page:** *Print* (booklets for each version, answer sheets — how many per
  version — and answer keys), *Add answers* (scan / type), and the gradebook. No join code,
  window, open/close or extra time.
- **Gradebook:** a *Version* column, and *Source* (online/scan/typed). Reset becomes *Delete*.
  Item % per question is computed by question (not position), so versions don't mix it up.

---

## Delivery: three parts (one PR each)

| Part | Content |
|---|---|
| 1 | `delivery.modes` setting; paper assignments (data model, assign dialog, page); seeded versions; print booklets + answer keys + answer sheets; **typed** answers → graded paper attempts; gradebook Version/Source columns. Usable end to end without scanning. |
| 2 | **Scanning**: OMR reader (worker, unit-tested on synthetic sheets), photo + PDF upload, review screen with flags, bulk save. e2e: print a sheet, fill it programmatically, upload, check the gradebook. |
| 3 | Fewer mistakes, before real-world feedback: an optional **class list** (paste "ID, name") per paper exam that fills in names, flags scanned or typed IDs that aren't on it (catches misread IDs), and shows who has no answers yet; **per-version averages** in the gradebook. Print tuning and a real-photo accuracy set wait for real use. |

Part 2 also opens Cloud Storage for the server only (rules stay deny-all) and adds the Storage
emulator to the e2e suite.

---

## Decisions (2026-11-26)

1. **Student IDs contain letters.** The sheet has an A–Z + 0–9 bubble grid (4–12 columns);
   *Digits only* is an option per exam for more question room. Unreadable IDs are flagged and
   typed on the review screen.
2. **Keep the scans.** Each sheet image is stored with its attempt in Cloud Storage
   (server-only), shown to professors, and deleted with the attempt or assignment.
3. **Paper size:** one layout that prints on both Letter and A4.
