# Blurred — Full Product Spec (v1)

## 1. Overview

Blurred is a daily image-guessing web game. One puzzle per day, same for all players. Each puzzle is a progressively-blurred image; players get 6 guesses, with blur reducing after each wrong guess. Result is shareable as a text-based grid of boxes plus a CTA line inviting others to play (e.g. "Blurred #1 — Solved in 4/6 tries. Can you beat my score? Play now: blurred-game.vercel.app").

This spec covers the full product: gameplay, data model, Firebase architecture, admin form, perceptual-hash dedup, and infra decisions. Existing local prototype (Next.js/React, 7 static images) is being migrated to Firestore + Cloud Storage with an admin form for content creation.

---

## 2. Core Gameplay Spec

### 2.1 Loop

1. Player loads app → today's puzzle fetched by UTC date.
2. Image displayed at max blur (Step 1).
3. Player submits a text guess.
4. Guess normalized and checked against accepted answers.
5. Correct → win state, image fully clears, confetti, share screen.
6. Incorrect → blur reduces one step, guess added to history, attempt count increments.
7. After 6 incorrect guesses → loss state, correct answer revealed, share screen.
8. Result (win/loss, attempts used) persisted to `localStorage`; revisiting same day shows result screen, not replay.

### 2.2 Blur Steps — Server-Rendered Variants (Security Fix)

**Problem with client-side CSS blur:** applying `filter: blur(Npx)` in the browser to a full-resolution image means the unblurred file is already sent to the client on page load — anyone can open dev tools, inspect the `<img>` element, or check the network tab to see the clear image immediately, regardless of what CSS is layered on top. This is a real vulnerability, not a cosmetic one, and must be fixed at the data layer, not the styling layer.

**Fix:** pre-render 6 actual blurred image files server-side at upload time (via `sharp`), plus one fully clear version. The client only ever receives the file matching their current attempt — the clear image is never transmitted until it's earned (win or loss reveal).

| Attempt #       | Blur radius (px) | File served  |
| --------------- | ---------------- | ------------ |
| 1 (initial)     | 24               | `step-1.jpg` |
| 2               | 20               | `step-2.jpg` |
| 3               | 18               | `step-3.jpg` |
| 4               | 16               | `step-4.jpg` |
| 5               | 12               | `step-5.jpg` |
| 6 (last)        | 8                | `step-6.jpg` |
| Win/Loss reveal | 0                | `clear.jpg`  |

Blur radii defined as a constant, used at generation time (not runtime CSS):

```js
export const BLUR_STEPS = [24, 20, 18, 16, 12, 8];
```

**Client behavior:** on each attempt, the client requests only the URL for that attempt's step from the puzzle doc's `imageVariants` map (see §3.1). It never has access to `clear.jpg`'s URL until the game reaches a win or loss state. No CSS blur filter is applied client-side anymore — the blur is baked into the image file itself.

**Remaining consideration:** if Storage paths/URLs were guessable or sequential, a determined user could still fetch `clear.jpg` early by guessing the URL. Mitigated by using non-sequential, random `puzzleId`s as the folder name (not the sequential `puzzleNumber`), and by only ever exposing the current step's URL to the client — never the full `imageVariants` map for future/unreached steps.

### 2.3 Guess Validation

- Normalize: lowercase, trim, strip punctuation, collapse whitespace.
- Match against `answer` plus all entries in `acceptedAnswers[]` (array authored per puzzle to cover synonyms/spelling variants, e.g. "eiffel tower" / "the eiffel tower" / "tour eiffel").
- Simple Levenshtein distance ≤1 tolerance for typos (optional, v1.1 — not required for launch).
- No dictionary/word validity check needed (unlike Wordle) — any string is a valid guess attempt.
- **Runs server-side** (via `POST /api/puzzle/guess`, see §8) rather than client-side — the answer and accepted variants must never be sent to the client before a win/loss, since a client-visible answer would be exposed in the network tab exactly like the original image blur issue.

### 2.4 Result / Share Format

```
Blurred #42
Solved in 3/6 tries. Can you beat my score?
🟥🟥🟩⬜⬜⬜
Play now: blurred-game.vercel.app
```

- 🟥 = wrong guess, 🟩 = correct guess (final), ⬛ = loss (all 6 used, no green), ⬜ = unused attempts.
- Loss variant swaps the CTA line to something like "Couldn't crack it today. Think you can? Play now: blurred-game.vercel.app"
- Copy-to-clipboard button. No image export in v1.

### 2.5 Daily Rotation Rule

- One puzzle per UTC calendar day, identical for every player (no per-user randomization).
- Puzzle selected by exact `date` field match — not random index, not "days since epoch modulo N" (that scheme breaks once puzzles are added/removed out of order).
- If no puzzle exists for today (content gap), app falls back to most recent past puzzle with a "replay" label — this should not happen in practice if the queue is maintained, but prevents a blank/broken screen.

---

## 3. Data Model (Firestore)

### 3.1 `puzzles` collection

```
puzzles/{puzzleId}
{
  date: "2026-07-15",          // string, YYYY-MM-DD, UTC, unique per doc
  puzzleNumber: 42,             // sequential display number, e.g. "Blurred #42"
  imageVariants: {
    step1: "https://firebasestorage.googleapis.com/.../step-1.jpg",
    step2: "https://firebasestorage.googleapis.com/.../step-2.jpg",
    step3: "https://firebasestorage.googleapis.com/.../step-3.jpg",
    step4: "https://firebasestorage.googleapis.com/.../step-4.jpg",
    step5: "https://firebasestorage.googleapis.com/.../step-5.jpg",
    step6: "https://firebasestorage.googleapis.com/.../step-6.jpg",
    clear: "https://firebasestorage.googleapis.com/.../clear.jpg"
  },
  answer: "eiffel tower",
  acceptedAnswers: ["eiffel tower", "the eiffel tower", "tour eiffel"],
  category: "landmark",          // optional, not used in v1 gameplay, useful for future filtering
  phash: "f4a2b8c1d3e5a9c2",     // perceptual hash of the original upload, hex string
  createdAt: <timestamp>,
  createdBy: "admin_uid"
}
```

**Important:** the client only ever fetches one field of `imageVariants` at a time — the one matching the player's current attempt number — never the whole map upfront. See §8 for the fetch pattern that enforces this.

Indexes needed:

- Single-field index on `date` (ascending) — for "get today's puzzle" and "get max date" queries.
- Single-field index on `puzzleNumber` (ascending) — for sequential numbering assignment.

### 3.2 `usedImageHashes` collection (permanent, never pruned)

```
usedImageHashes/{hashDocId}
{
  phash: "f4a2b8c1d3e5a9c2",
  puzzleId: "puzzles/abc123",   // reference, informational only
  dateUsed: "2026-07-15",
  createdAt: <timestamp>
}
```

This collection persists independently of `puzzles` — deleting a puzzle doc or its Storage image does **not** delete its hash record. This is the dedup source of truth.

### 3.3 Why two collections instead of one

`puzzles` is expected to be pruned over time (old images deleted to save storage). `usedImageHashes` must never be pruned, or dedup silently breaks. Keeping them separate means storage cleanup can never accidentally destroy dedup history.

---

## 4. Cloud Storage Structure

```
/puzzles/{puzzleId}/step-1.jpg    — heaviest blur (attempt 1)
/puzzles/{puzzleId}/step-2.jpg
/puzzles/{puzzleId}/step-3.jpg
/puzzles/{puzzleId}/step-4.jpg
/puzzles/{puzzleId}/step-5.jpg
/puzzles/{puzzleId}/step-6.jpg    — lightest blur (attempt 6)
/puzzles/{puzzleId}/clear.jpg     — fully clear, only served on win/loss reveal
```

- 7 files per puzzle instead of 1 — negligible storage cost increase at these image sizes.
- `puzzleId` must be a non-guessable random ID (not the sequential `puzzleNumber`) so step/clear URLs can't be predicted or brute-forced by incrementing a number.
- No separate "thumbnail" needed beyond these 7 — they already serve as the only display sizes needed.
- Storage rules: public read (URLs are only discoverable via the specific field the client requests, not by guessing), write restricted to Admin SDK only (see §7).

---

## 5. Perceptual Hash Dedup System

### 5.1 Purpose

Prevent accidentally re-using an image that's already been a puzzle, even after the original file and Firestore doc have been deleted (e.g. after 40-50 puzzles, admin prunes old images from Storage to save cost, but must still avoid reusing them later).

### 5.2 Method

- Perceptual hash (pHash), 64-bit, computed via DCT (discrete cosine transform) on a downscaled grayscale version of the image. Standard approach — not custom-built.
- Library: `sharp` (image resize/grayscale preprocessing) + `phash` or `imghash` npm package for the hash computation itself. Both run server-side inside a Next.js API route (Node runtime, not Edge — `sharp` needs Node).

### 5.3 Flow (on new image upload via admin form)

1. Admin form sends the raw original image file (multipart/form-data or base64) directly to a Next.js API route (e.g. `POST /api/admin/create-puzzle`) — no separate staging upload to Storage first, no Storage trigger involved.
2. API route verifies admin auth (see §6.4), then computes pHash of the incoming file in-memory.
3. Route queries `usedImageHashes` for any hash within Hamming distance ≤ 7 (bitwise XOR + popcount against all stored hashes — trivial at this scale, no ANN index needed under ~10k images).
4. **If duplicate found:** return error response, nothing written anywhere ("This image (or a close variant) was already used on {date}").
5. **If clear:** generate the 7 image variants (`sharp` blur at each `BLUR_STEPS` radius, plus the untouched original as `clear.jpg`), upload all 7 to `/puzzles/{puzzleId}/` (via Admin SDK), create `puzzles` doc with the resulting `imageVariants` URL map, create `usedImageHashes` doc, return success.

### 5.4 Threshold

- Hamming distance ≤ 7 (out of 64 bits) flagged as duplicate. Set value; tune after real usage — too low misses recrops, too high false-positives on genuinely different but similarly-composed images.

### 5.5 Cost/perf notes

- Comparison is O(n) linear scan against all stored hashes — at 1,000-10,000 images this is single-digit milliseconds. No need for vector DB or ANN indexing at this scale.
- Running `sharp` inside a Next.js API route on Vercel works fine on the Node runtime; just ensure the route isn't configured as Edge (Edge doesn't support native binaries like `sharp`).

---

## 6. Admin Form (Content Creation)

### 6.1 Scope

Single authenticated page, one form. Not a management dashboard — no listing, editing, or searching past puzzles in v1.

### 6.2 Form fields

- Image file upload (required)
- Answer (text, required)
- Accepted answer variants (dynamic list, add/remove rows, optional beyond the primary answer)
- Category (optional dropdown/text)

### 6.3 Submit flow

1. Client submits form (image + fields) directly to `POST /api/admin/create-puzzle`.
2. Route runs perceptual hash dedup check (§5.3).
3. If clear:
   - Query max existing `date` in `puzzles` collection → assign `date = maxDate + 1 day` (or today, if collection empty).
   - Query max `puzzleNumber` → assign `puzzleNumber = max + 1`.
   - Generate the 7 blur variants server-side and upload all to `/puzzles/{puzzleId}/` via Admin SDK (§5.3 step 5).
   - Write `puzzles` doc (with `imageVariants` map) and `usedImageHashes` doc (atomic via Firestore batch write).
4. Return success/failure + assigned date to admin form, shown as confirmation ("Scheduled for 2026-07-16, Puzzle #43").

### 6.4 Auth

- Single hardcoded admin UID (or small allowlist) checked via Firebase custom claims.
- Admin form route protected client-side (redirect if unauthenticated) **and** server-side inside the API route itself (verify the Firebase ID token server-side via Admin SDK, reject if UID isn't in the allowlist) — client-side check alone is not sufficient security.

### 6.5 Bulk Delete (Storage Cleanup)

- Separate small control on the same admin page (not a full dashboard) — "Delete oldest N puzzles' images," N entered manually (e.g. 50 or 100).
- Flow:
  1. Admin enters N, clicks delete.
  2. Client calls `POST /api/admin/delete-oldest` with `{ count: N }`.
  3. Route (after verifying admin auth) queries `puzzles` ordered by `date` ascending, takes oldest N.
  4. For each: delete all 7 image variant files under `/puzzles/{puzzleId}/` in Storage, delete the `puzzles` Firestore doc.
  5. **Does not touch `usedImageHashes`** — those records are permanent and independent, so dedup still works against images that no longer exist.
  6. Return confirmation: "Deleted 50 oldest puzzles (up through 2026-05-10)."
- No individual selection/preview list in v1 — just a count-based bulk action. Reviewing/selecting specific puzzles before deletion is dashboard territory (out of scope for now).
- Same auth rule as puzzle creation: verified server-side inside the API route, admin UID check against allowlist.

---

## 7. Security Rules

### 7.1 Firestore

```
match /puzzles/{puzzleId} {
  allow read: if true;
  allow write: if false; // writes only via Admin SDK from Next.js API routes, which bypass rules
}
match /usedImageHashes/{hashId} {
  allow read: if false;  // no client needs to read this directly
  allow write: if false; // Admin SDK only, via API routes
}
```

### 7.2 Storage

```
match /puzzles/{puzzleId}/{fileName} {
  allow read: if true;  // files are only discoverable via URLs served by the API, not by listing
  allow write: if false; // only the Admin SDK (from a Next.js API route) writes here
}
```

No `/staging/` path needed — the API route receives the file directly, generates all variants, and writes straight to `/puzzles/{puzzleId}/` after the dedup check passes, so there's no client-writable staging bucket to secure.

**Critical:** Storage read rules alone don't prevent someone from guessing a `clear.jpg` URL if they somehow learn the `puzzleId`. The real protection is at the application layer (§8): the client is never given the full `imageVariants` map, only the single URL for the current attempt, fetched via a server-side API route rather than a direct Firestore read. This is why §8's fetch pattern matters as much as these rules — rules alone are necessary but not sufficient here.

All actual puzzle creation happens server-side inside Next.js API routes using the Firebase Admin SDK, which bypasses security rules entirely — the client never writes directly to Storage or the `puzzles` Firestore collection.

---

## 8. Client Fetch Pattern

**Security-critical change from the original design:** the client must never receive the full `puzzles` document directly (that would include the entire `imageVariants` map, including `clear.jpg`, defeating the whole point of §2.2's fix). Puzzle metadata and image URLs are served through a server-side API route that filters what's exposed.

1. On load, client computes today's date (UTC, `YYYY-MM-DD`) and calls `GET /api/puzzle/today?attempt=1` (attempt number tracked client-side via existing `localStorage` progress state).
2. The API route (server-side) looks up today's `puzzles` doc by `date`, but returns only:
   - `puzzleId`, `puzzleNumber`, `date`
   - The single image URL matching the requested `attempt` number (e.g. `imageVariants.step1`)
   - **Not** `answer`, `acceptedAnswers`, `phash`, or any other step's URL.
3. On each subsequent wrong guess, client re-calls the same endpoint with the incremented attempt number to get the next step's URL.
4. Guess checking also happens server-side: client sends the guess to `POST /api/puzzle/guess` with `{ puzzleId, guess }`; the route compares against `answer`/`acceptedAnswers` server-side and returns only `correct: true/false` — the answer itself is never sent to the client except on win/loss reveal (at which point `clear.jpg`'s URL and the answer text are both safe to return).
5. No pagination or bulk fetch of puzzle history needed in v1 (no archive feature).

This means guess validation moves from client-side (as originally implied) to server-side — necessary since the answer string can't live in client-accessible data at any point before reveal, or it could be read from a network response the same way the image was.

---

## 9. Statistics (Local, No Accounts)

### 9.1 Principle

Zero friction — no login, no accounts, no cloud sync. All stats computed and stored entirely in `localStorage`, same device/browser only. Same tradeoff Wordle shipped with originally: clearing browser data or switching devices resets stats. Accepted tradeoff for v1.

### 9.2 Stats tracked (mirrors Wordle exactly)

- **Games played** — total puzzles attempted (win or loss counts, in-progress does not).
- **Win %** — wins / games played.
- **Current streak** — consecutive days played _and won_, ending today or yesterday.
- **Max streak** — highest current streak ever reached.
- **Guess distribution** — bar chart, count of wins landing on guess 1 through 6. Losses don't add to any bar but do count toward games played / streak-breaking.

### 9.3 Streak logic

- Streak increments only on a **win**.
- Streak **breaks** (resets to 0) if:
  - The player loses (uses all 6 guesses without correct answer), or
  - The player misses a calendar day entirely (no puzzle played on a given UTC date, detected by comparing last-played date to today on next visit).
- Streak check happens client-side on load: compare `lastPlayedDate` (stored) to today's date. If gap > 1 day, reset `currentStreak` to 0 before displaying stats.

### 9.4 Data model (localStorage)

```json
{
  "blurred_stats": {
    "gamesPlayed": 12,
    "gamesWon": 9,
    "currentStreak": 3,
    "maxStreak": 5,
    "lastPlayedDate": "2026-07-15",
    "guessDistribution": [0, 2, 3, 2, 1, 1]
  }
}
```

- Separate from the existing per-puzzle "already played today" progress key — `blurred_stats` is cumulative and persists across all days; per-day progress key only tracks today's in-progress/completed state.
- Update `blurred_stats` once per completed game (win or loss), immediately after the result is determined, before showing the result screen.

### 9.5 Stats screen

- Accessible from a header icon (bar-chart icon, standard Wordle placement) — viewable any time, not just post-game.
- Also auto-shown appended below the share/result screen after each completed game (matches Wordle's flow: result → stats → share button).
- Displays: games played, win %, current streak, max streak as four stat blocks, plus guess distribution bar chart below.
- No reset button in v1 (no accounts means no "start fresh" flow needed beyond manually clearing browser storage).

### 9.6 New component required

- `components/stats-screen.tsx` — renders the four stat blocks + guess distribution chart, reads from `blurred_stats` in localStorage.
- `lib/puzzles.ts` (or a new `lib/stats.ts`) — houses read/update/streak-check logic, called once per game completion.

---

## 10. Explicitly Out of Scope for v1

- Admin dashboard (listing/editing/searching past puzzles)
- Puzzle archive/replay feature for players
- Accounts, cloud-synced stats, cross-device stats
- Image resizing/thumbnail variants
- Approximate nearest-neighbor hash indexing (not needed until >10k images)
- Typo-tolerant fuzzy matching beyond exact + accepted-variants list
- Sponsor/brand integration of any kind
- Bulk-upload UI (form handles one image at a time)
- Stats reset/clear button

---

## 11. Tech Stack Summary

- Next.js 16, React 19, TypeScript, Tailwind CSS (existing)
- Firebase: Firestore (metadata), Cloud Storage (images), Firebase Auth (admin-only, custom claims) — Admin SDK used server-side within Next.js API routes for all writes
- Next.js API routes (Node runtime) handle puzzle creation, blur variant generation, dedup check, guess validation, and bulk delete — no Cloud Functions
- `sharp` + `imghash`/`phash` npm package for perceptual hashing and blur variant generation (runs inside API routes)
- Server-side image serving pattern (§8) — client never receives the full puzzle document or more than one image URL at a time; guess checking also happens server-side
- Canvas Confetti (existing, win state)
- Vercel (hosting, existing) + Vercel Analytics

---

## 12. Resolved Decisions

1. Hamming distance threshold for dedup: **7**.
2. `category` field: unused in v1 gameplay, kept in schema for future filtering only.
3. Image deletion: admin will periodically bulk-delete oldest N images via the form control in §6.5; `usedImageHashes` remains intact regardless, so dedup stays safe.
