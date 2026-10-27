# NSS — Back Navigation, Answer Corrections, and Duplicate Prevention

Status: **migration 0021 applied to production (2026-10-27, via the Supabase SQL Editor). Verified read-only afterward: RPC exists and callable, no data changed (row counts and a sample identical to pre-migration). Application not yet deployed.**

This report now covers three phases: (1) the original Back-navigation/review/duplicate-prevention implementation, (2) a follow-up pass resolving remaining database-concurrency concerns and adding real component-level respondent-journey tests, and (3) a final pass that closes the one gap phase 2 explicitly left open — genuine concurrent-transaction behavior — and directly verifies the deployment-transition safety claim, both without a staging project, Docker, or any cloud dependency. Each phase's findings and changes are called out explicitly in each section below.

**Phase 4 (pre-execution review, against real production data, read-only):** before applying this migration to production, two more issues were found and fixed:
- The partial index's cutoff (`2026-10-26T19:19:32.000Z`, chosen at authoring time) came within about 3 hours of overlapping with the function's own clock-skew guard's accepted window by the time of actual deployment — a legitimately-accepted, guard-passing write could in principle have landed just outside the index's coverage. Fixed by moving the cutoff back to `2026-10-20T00:00:00.000Z` (confirmed via a read-only production query: the latest actual historical duplicate is 2026-09-25, so this still clears all real historical data with margin) and tightening the guard's backward tolerance from 1 day to 2 hours (the forward/future-skew bound stays at 1 day — that's the dangerous direction; the backward one never needed more than ordinary clock-drift tolerance).
- The stale-write comparison read `answered_at` via an unordered, non-aggregated `SELECT ... FOR UPDATE` — with more than one existing row for a key (confirmed: 15 real historical duplicate groups exist in production today), Postgres gives no guarantee which row that returns. Fixed by locking all matching rows first, then reading `max(answered_at)` separately (an aggregate can't be combined with `FOR UPDATE` in one statement). In practice, given the guard+cutoff margin above, no reachable call can currently make the old arbitrary pick produce a different accept/reject outcome than `max()` would — but the correctness of this comparison shouldn't depend on that incidental property of a separately-tunable guard, so it's fixed regardless.
- Re-verified: read-only query confirms zero duplicate `(submission_id, question_id)` pairs with `answered_at` at or after the new cutoff (migration will create cleanly), all local PostgreSQL test suites re-run and passing (53 tests total), `tsc`/`eslint`/build clean.

**Phase 5 (final safety review, requested before production execution):** a syntax-error concern raised against the SQL as pasted into chat was checked and was not present in the file — the file's own line/statement counts, a fresh real-Postgres execution of all three PostgreSQL test suites, and a checksum were used to confirm the exact tested file, not a chat transcription of it, is what's being reviewed. Two further, real findings from this pass, both fixed:
- **PUBLIC execute grant:** Postgres grants `EXECUTE` on a new function to `PUBLIC` by default, which includes Supabase's `anon` role — the migration granted to `authenticated` but never explicitly revoked the implicit `PUBLIC` grant. Not actually exploitable (the function's own `auth.uid()` check already rejects an anonymous caller before any read/write), but not something to rely on instead of the grant itself. Fixed: `REVOKE EXECUTE ... FROM PUBLIC` added before the `GRANT ... TO authenticated`. Verified directly (not just by inspection): a new test creates a disposable `anon` role, confirms it gets a real Postgres permission-denied error (not the internal auth check), then confirms `authenticated` still succeeds.
- **Cluster-name validation:** `question_id` is already protected by an existing foreign key to `nss_questions` (`0001_init_schema.sql`, unaffected by this migration), but `chosen_clusters`/`rejected_clusters` are a plain `text[]` column with no FK or enum — nothing stopped an arbitrary string from being written straight into Bradley-Terry's scoring input. Fixed: both values are now checked against the 7 known cluster names. **Not fixed, and explicitly out of scope:** verifying the two clusters are the actual pair `question_id` maps to would need a lookup against `nss_questions.cluster_a`/`cluster_b` — a materially bigger change than this migration's approved scope. Today's legitimate client always derives both values from the same question object, so this is a pre-existing trust-boundary property of the schema, not a regression introduced by this migration — called out here as a known, accepted limitation rather than silently left unmentioned.
- Re-verified: all three real-Postgres suites re-run fresh (14 tests), full suite 54 tests passing, `tsc`/`eslint`/build clean, migration re-confirmed additive-only (no `UPDATE`/`DELETE`/`TRUNCATE` against existing data outside the function body, which only executes at respondent-write time, not at migration-apply time).

## 1. What changed

| File | What |
|---|---|
| `supabase/migrations/0021_nss_responses_unique_per_question.sql` | New, **not applied**. Partial unique index + `SECURITY DEFINER` function `upsert_nss_response`: ownership-checked, field-validated, clock-skew-guarded, stale-write-protected, advisory-lock-serialized delete-then-insert. **Phase 2:** added the advisory lock and the clock-skew sanity guard. **Phase 3:** fixed the advisory lock call itself — it was passing two `bigint`s to `pg_advisory_xact_lock`, a signature that doesn't exist on real Postgres (only a single-`bigint`-key form and a two-`int`-key form do); phase 2's pglite-based test didn't catch this because pglite doesn't implement this function at all and so needed a stub, and the stub's signature was written to match the (wrong) call instead of a real one. Caught by testing against genuine, unstubbed Postgres (§3). Still adds nothing that reads, deletes, or modifies an existing row. |
| `src/lib/nss/api.ts` | `upsertResponse` calls the RPC; takes a client-captured `answeredAt`. `StaleWriteError` class for callers to treat a superseded write as a benign no-op. Unchanged in phase 2. |
| `src/lib/nss/questionHistory.ts` | Pure, dependency-free module holding the real decision logic: confirmation vs. correction vs. first decisive answer, decisive-answer count, validation-trigger condition. Unchanged in phase 2. |
| `src/app/survey/SurveyClient.tsx` | Reworked history model, review-vs-frontier navigation, Back/Next handling, write-call-site retry/stale-write handling, localStorage persistence, cross-device resume reconstruction. Unchanged in phase 2 (phase 2 tests exercise this file as-is; no bugs were found in it requiring a fix). |
| `src/components/survey/QuestionCard.tsx` | `selected`/`reviewing`/`selectedOption`/`skipped`/`onNext` props; "Reviewing your answer" / "You skipped this one" labels; "Next" in place of "It Depends"/"Skip" while reviewing. Unchanged in phase 2. |
| `src/lib/nss/__tests__/questionHistory.test.ts` | 16 tests on the decision logic. Unchanged in phase 2. |
| `src/components/survey/__tests__/QuestionCard.test.tsx` | 8 tests on the UI-state half. Unchanged in phase 2. |
| `src/lib/nss/__tests__/upsertNssResponse.pg.test.ts` | **Phase 2.** Executes the real, unmodified migration SQL against a genuine embedded PostgreSQL engine (`@electric-sql/pglite`) — 9 tests. **Phase 3:** updated the `pg_advisory_xact_lock` compatibility stub's signature to match the (now-fixed) real call. See §3. |
| `src/app/survey/__tests__/SurveyClient.test.tsx` | **Phase 2.** Mounts the real `SurveyClient` component (real hooks, real `QuestionCard`, real `questionHistory.ts`/`api.ts` call sites) against a mocked Supabase client and a small question-bank fixture — 7 tests. See §4. |
| `src/lib/nss/__tests__/upsertNssResponse.realConcurrency.test.ts` | **New, phase 3.** Two genuinely concurrent database connections (real TCP, real separate transactions) against a real, temporary, local PostgreSQL server — proves the advisory lock's actual blocking behavior, not just its documented behavior. 3 tests. See §3. |
| `src/lib/nss/__tests__/deploymentTransition.realPg.test.ts` | **New, phase 3.** Simulates a respondent mid-survey through the exact migration-then-deploy sequence — old-code writes, a live migration apply, more old-code writes, a new-code resume and correction — using the real `upsertResponse`/`listResponsesForSubmission` from `api.ts` against the same kind of real local Postgres. 1 test. See §5. |
| `vitest.config.mts`, `vitest.setup.ts` | RTL/jsdom wiring. **Phase 2:** added a `@` path alias and `NEXT_PUBLIC_NSS_ENGINE=bt` test env. Unchanged in phase 3. |
| `package.json` / `package-lock.json` | **Phase 2:** `@electric-sql/pglite`. **Phase 3:** `embedded-postgres` (a real, temporary, multi-connection PostgreSQL server distributed as platform-specific npm binary packages — not Docker, not a cloud project), `pg` (the standard Node Postgres client), `@types/pg`. All dev-only. |

No change to `surveyEngine.ts`, `adaptiveDelivery.ts`, or `bradleyTerry.ts` in either phase — the scoring/delivery methodology itself is untouched.

## 2. Final respondent behavior

Unchanged from phase 1; reproduced here for completeness.

### Back navigation / restoration

| Previous state of the question being returned to | What's shown |
|---|---|
| Answered normally | Standard wording, previous answer marked selected |
| Answered after "It Depends" | Sharpened wording, previous answer marked selected |
| Skipped after "It Depends" | Sharpened wording, "You skipped this one" indicator, no option marked |
| Not yet reached | Standard wording, nothing marked (ordinary fresh question) |

### Reviewing vs. answering fresh

- **Fresh/frontier question:** unchanged — pick an option, advance immediately.
- **Reviewing:** both options render, the previous one marked; a **Next** button advances without writing if nothing changed; a different pick is a correction; the same pick again is a confirmation; a previously-skipped question answered decisively increments the count.
- Reviewing walks forward through the sequence exactly as delivered — never jumps to the frontier.
- "It Depends" during review of a standard answer shows the sharpened card with nothing marked yet (the original standard answer isn't lost if the respondent backs out or clicks Next instead of picking).

### Validation trigger

The validation trigger is the explicit "It Depends" signal alone, not every correction — a plain correction on standard wording isn't treated as evidence of contextual uncertainty.

## 3. Database concurrency, PostgreSQL verification, and live-testing limits

### 3a. The concurrency gap you flagged, and the fix

You were right that `SELECT ... FOR UPDATE` only locks a row that already **exists**. Two concurrent first-time writes for the same `(submission_id, question_id)` would both pass that `SELECT` with nothing to lock, then both proceed toward `INSERT` — a real gap in the phase-1 design.

**Fix:** a transaction-scoped advisory lock, `pg_advisory_xact_lock(hashtext(p_submission_id::text), p_question_id::int)`, acquired *before* the existence check. This serializes **every** concurrent call for the same `(submission, question)` key — first-time inserts and corrections alike — regardless of whether a row exists yet. It's released automatically at transaction end (commit or rollback), so there's no separate unlock step and no risk of holding it past the call. Two independent keys never block each other (different questions, or different submissions, proceed concurrently). The two-argument lock-key form (a hash of the submission id, and the literal question id) means a collision would require both to coincide, not just one combined hash.

(An earlier draft of this call used `hashtextextended(...)` cast with `::bigint` on both arguments — `pg_advisory_xact_lock` has no `(bigint, bigint)` overload at all; only a single-`bigint`-key form and this two-`int`-key form exist. That version would have failed on real Postgres with "function does not exist" on literally every write. It passed against pglite only because pglite doesn't implement this function and so needed a compatibility stub, and the stub was written to match the call rather than real Postgres — exactly the kind of thing §3c's real-Postgres test exists to catch, and did.)

Walking through each scenario you listed, with the advisory lock in place:
- **Two concurrent first-time writes, same question:** now genuinely serialized — the second call's `SELECT` (after acquiring the lock) sees the first call's committed row, and proceeds down the normal "existing row" path instead of racing toward a duplicate insert.
- **Two concurrent corrections to an existing answer:** same serialization; whichever acquires the lock first completes its full delete-then-insert before the second one even reads.
- **A delayed older answer arriving after a newer one:** unaffected by the lock itself — this is what the existing stale-write timestamp check (unchanged) handles, and it still does, serialized or not.
- **Corrections to pre-migration submissions with existing historical rows:** unaffected by the lock; the `DELETE` matches by key regardless of the partial index's cutoff, as before — now additionally verified by direct execution (§3b).
- **Concurrent writes where historical duplicates already exist:** the lock serializes the *new* writes; historical duplicate rows are never touched by this function at all (by design — see §7 on historical data).
- **A retry after a failed/interrupted write:** an idempotent retry of the exact same payload now also verified directly to succeed harmlessly, not duplicate (§3b).
- **Submission ownership/authorization:** unchanged, and now directly verified (§3b), not just read.
- **Can any scenario leave multiple authoritative rows, lose the final answer, or produce an unhandled error?** With the lock in place: no for the two concurrency scenarios the lock was added for. The stale-write check still prevents an older answer from overwriting a newer one. No scenario found that silently loses data; every rejection path raises an exception the client either retries once or surfaces to the respondent (`writeResponseWithRetry`), never swallows silently server-side.

### 3b. Real PostgreSQL verification — not just code review

Per your instruction not to claim verification without actually testing it: this environment has no `psql`, `docker`, `supabase` CLI, or Homebrew available, and `.env.local` has only one configured Supabase project (treated as production — not used for testing). Rather than stop at code review, I added `@electric-sql/pglite` — a WASM build of **real PostgreSQL** (not a reimplementation or a mock) as a dev-only test dependency, and wrote `src/lib/nss/__tests__/upsertNssResponse.pg.test.ts`, which reads and executes the **actual, unmodified migration file** from disk against it.

One compatibility shim was required and is clearly isolated: pglite is a single-connection embedded engine (there's no second session to coordinate with), so it doesn't implement `pg_advisory_xact_lock` at all — the test schema defines a no-op stand-in for exactly that one function before running the real migration SQL, and the test file's header comment says so explicitly. Nothing else in the migration is modified for the test.

**Result: 9/9 passing, all genuine Postgres execution:**
- Ownership/authorization enforcement (rejects a write for someone else's submission; accepts it for the owner).
- Field validation (invalid selection; chosen == rejected cluster).
- The clock-skew guard (rejects a timestamp a year in the future; accepts normal few-minutes drift) — this one is a nice confirmation beyond the logic itself, since the test's first run caught my own test fixtures using a now-stale hardcoded date, correctly rejected by the real guard running on the real current server clock.
- Stale-write rejection: a delayed older answer arriving after a newer one is rejected, and the newer one survives.
- A correction replaces the existing row rather than duplicating it.
- Correcting a **pre-migration** row (inserted directly, with an `answered_at` before the partial index's cutoff, bypassing the function — simulating a real historical row) replaces it correctly, not duplicating it.
- A question with pre-existing **historical duplicate** rows (two rows bypassing the function, simulating the original bug) converges to one row after a correction through the function.
- An idempotent retry of an already-applied write (identical payload) succeeds harmlessly, without duplicating.
- The partial unique index itself genuinely enforces uniqueness for post-cutoff rows if the function is bypassed entirely (a raw duplicate `INSERT` is rejected with a real Postgres unique-violation).

**What this does and does not prove, stated plainly:**
- **Proves, on real Postgres, not by code review:** everything listed above — syntax correctness of the whole migration, the ownership/validation/clock-skew/stale-write/pre-migration-row logic, and that the partial index is a real, working backstop.
- **Does not prove:** the advisory lock's actual cross-session blocking behavior, or a genuine concurrent-transaction race. pglite is single-connection by nature — there is no second, independent session to race against, which is exactly why `pg_advisory_xact_lock` had to be stubbed out rather than exercised. **This gap is closed in §3c, below, without needing staging or Docker.**

### 3c. Genuine concurrent-transaction verification — closing the one remaining gap, still fully local

You asked specifically whether a temporary local PostgreSQL instance could test the advisory lock with genuinely concurrent connections, rather than create a permanent staging environment for it. It can: `embedded-postgres` is a real compiled PostgreSQL server distributed as platform-specific npm packages (not Docker, not WASM, not a reimplementation) — it spawns an actual `postgres` process with `initdb`, listens on a real TCP port, and supports any number of genuinely independent connections, same as any real Postgres server. `src/lib/nss/__tests__/upsertNssResponse.realConcurrency.test.ts` starts one fresh (temp data directory, torn down after), applies the real migration SQL with **no compatibility shims at all** (`pg_advisory_xact_lock` is the genuine function here), and opens two separate `pg` client connections to race against each other for real.

This is also exactly what caught the bug described in §1/§3a: the first run failed with "function `pg_advisory_xact_lock(bigint, bigint)` does not exist" — a signature that genuinely doesn't exist on any real Postgres, which pglite's necessary stub had been masking. Fixed (now `hashtext(...)::int, question_id::int`, matching the real two-integer-key overload), re-verified against both pglite and this real-connection suite.

**Result: 3/3 passing, against two truly independent, simultaneously-open transactions:**
- Two concurrent *first-time* writes for the same question: connection 2's call is issued while connection 1's transaction is still open (not yet committed) — connection 2 **genuinely blocks** (verified by waiting 500ms and confirming it still hasn't resolved) until connection 1 commits, then proceeds. Exactly one row survives.
- Two concurrent *corrections* to an already-existing answer: same genuine block-then-proceed behavior, exactly one row survives.
- Two concurrent writes to **different** questions: confirmed *not* blocked by each other (the lock is correctly scoped per question, not a blanket serialization that would make the whole app single-threaded per submission).

This is no longer "verified by documentation and code review" — it's an observed, repeatable (ran 3x consecutively with no flakiness, ~1.6s each) block in a real Postgres process, which is exactly the property the advisory lock was added for. Nothing about this required a staging project, Docker, or any persistent environment — the server is created and destroyed within the test run.

### 3d. Client-generated timestamp reliability across devices

Investigated as asked. Client timestamps are reliable for the dominant real threat this was built for — a single device's own requests racing each other (slow retry vs. a fresh click) — because in that case the two timestamps being compared always come from the *same* clock; there's no cross-device disagreement to go wrong. They are **not** reliable for two genuinely different devices/sessions writing concurrently with disagreeing clocks — there is no way to recover true ordering between two untrusted clocks after the fact. This app doesn't support or expect a respondent taking the survey on two devices at once, so this is accepted as a known, out-of-scope limitation rather than something worth building a server-assigned monotonic sequence for right now (that would be the correct fix *if* concurrent cross-device editing ever became a real supported case).

**What was implemented as a proportionate hardening, not a redesign:** the clock-skew sanity guard (§3a, verified in §3b) — a client timestamp implausibly far (>1 day) from the server's own clock is rejected outright, so a single badly-wrong device clock can't silently poison that submission's stale-write ordering indefinitely.

## 4. Survey integration test results

Added `src/app/survey/__tests__/SurveyClient.test.tsx`: mounts the **real** `SurveyClient` component — its actual `useState`/`useCallback` wiring, the actual `QuestionCard`, the actual `questionHistory.ts`/`api.ts` call sites — against a mocked Supabase client (a hand-written chainable builder covering exactly the calls `api.ts`/`userProfiles.ts` make) and a small, deterministic 31-question fixture (the 21 real calibration cluster-pairs plus 10 reused-pair adaptive-only questions). No testing framework beyond what was already added in phase 1 (Vitest + RTL + jsdom); no refactor of application code to make it testable.

One important wrinkle, worth stating plainly: `buildCalibrationSequence`'s random shuffle is called from *within* `surveyEngine.ts` on itself, so mocking the module's exported `shuffleArray` (as I first tried) does **not** intercept that internal call — calibration order is genuinely randomized every run, same as production. Rather than fight that, the tests read whatever question is actually on screen from its own rendered heading and act on that, the same way a real respondent would; confirmed stable across 5 repeated runs with 5 different random orders.

**7/7 passing**, covering:
- Back across multiple answered questions, a correction, and chronological forward review (not a jump to the frontier) — with assertions on the actual RPC call count, not just UI state, confirming the correction didn't produce a 4th write and the decisive count stayed at 2.
- Review "Next" without changing anything never issues another write.
- Skip under sharpened wording → Back restores sharpened wording + the skip indicator → a decisive answer afterward writes exactly once and increments the count.
- Answered via "It Depends" → Back restores sharpened wording with the answer marked (not standard).
- Reload/resume: a pre-seeded `localStorage` state (the real persisted shape) is picked up directly on mount, skipping the greeting, landing on the right question with Back correctly restoring the prior one.
- Calibration → adaptive handoff: answering 21 distinct questions in a row, then confirming question 22 is a genuinely new one (not a repeat) and the RPC was called exactly 21 times.
- Rapid repeated clicks: dispatching two raw click events inside a single React `act()` batch (the only way to actually land two clicks inside the pre-commit window `fireEvent.click`'s own auto-flushing closes on every individual call) results in exactly one RPC call and one advance — the `processingRef` guard genuinely holds.

Combined with the existing 32 tests from phase 1 and all the PostgreSQL-execution tests from §3 (pglite + the real-concurrency and deployment-transition suites, phase 3): **`npm test` → 8 files, 52 tests, all passing.** `npx tsc --noEmit`, `npx eslint`, and `npm run build` (Next 16 production build, Turbopack) all pass clean.

**Still not covered, honestly stated:** a true multi-tab/multi-session browser scenario (two real browser contexts hitting the same submission); the CSS `pointer-events: none` exit-animation defense specifically (jsdom doesn't do real hit-testing, so this layer can't be exercised here — only the `processingRef` timing guard was verified); any live Supabase network behavior (the mock is a faithful stand-in for the call shapes, not Supabase's actual server behavior).

## 5. Corrected deployment order and rollback

The previous version of this report had the order backwards. Corrected, as you specified:

1. **Verify the migration and application in staging** — apply the migration to a staging/local Supabase project and walk the manual acceptance tests in §6. The database-concurrency behavior itself no longer needs to be *discovered* in staging — it's already proven locally against real, genuinely concurrent Postgres connections (§3c) and the deployment transition itself is already proven against real local Postgres with the real application code (§5a, below) — staging at this point is a confirmatory sanity pass on the actual deployed environment, not where this gets verified for the first time.
2. **Apply the verified migration to production.** Schema-only (new index, new function, new grant) — never reads, locks for migration purposes, or modifies an existing row.
3. **Deploy the application code to production.**
4. **Production smoke test and monitor.** Confirm a real test submission can complete a few questions and a report; watch logs for `stale_write` (expected occasionally, benign) and any other `upsert_nss_response` failure (not expected).

### 5a. The deployment transition itself, verified with real code against real Postgres — not staging, not assumed

You asked specifically whether a respondent halfway through the survey during deployment can continue without losing answers, and not to assume the migration-first sequence is seamless just because it's reasoned to be safe. `src/lib/nss/__tests__/deploymentTransition.realPg.test.ts` verifies this directly: it spins up the same kind of real, temporary local Postgres as §3c, and plays out the exact sequence a real deployment produces for someone already mid-survey, using the **real, unmodified `upsertResponse`/`listResponsesForSubmission` from `api.ts`** (not reimplementations) for the "new code" side, and a write pattern read directly from the *currently deployed* `git HEAD` version of `api.ts` for the "old code" side (not guessed):

1. Old code writes 3 ordinary answers (plain delete-then-insert, no RPC — exactly what's live today).
2. The migration is applied to the live database. The simulated respondent's "tab" hasn't reloaded.
3. Old code writes a 4th answer — **after** the migration, **before** the app deploy. Must still succeed.
4. The app is "deployed," but the tab still hasn't reloaded — old code writes a 5th answer. Must still succeed.
5. The "reload" happens: new code calls the real `listResponsesForSubmission` and must see all 5 answers, correctly, including the one written under sharpened wording.
6. New code issues a real correction (the real `upsertResponse`/RPC path) to a row old code originally wrote (question 2, across the migration boundary) — must replace it, not duplicate it.
7. New code answers a fresh question (question 6).
8. Final check, directly against the database: all 6 questions present exactly once, in the right final state, nothing lost, nothing duplicated.

**Result: passing** (confirmed stable across 3 repeated runs). This is the strongest evidence available short of an actual staged rollout: genuine old-code behavior (read from the real deployed code, not assumed), a genuine live migration applied mid-session, and genuine new-code resume/correction logic, all exercised for real against a real database — with no staging project, no browser, and no production access of any kind.

**Why this order, specifically — checked against what's actually deployed today, not assumed:** I read the currently-committed (production) `SurveyClient.tsx`/`api.ts` to check what happens in each intermediate state, rather than guessing.

- **Migration applied, app not yet deployed (the new ordering's intermediate state):** the currently-deployed client does a plain `.delete()` then `.insert()` into `nss_responses` — two separate round trips, never calling the new RPC, and every write it issues is wrapped in `queueWrite(...).catch(() => {})`, which **already silently swallows any write error** today. The new partial unique index does apply to any row the old code writes going forward (its `answered_at` will be after the migration's cutoff), so the old code's *known* race (rapid clicks, reload-mid-write) could, in the moment the migration is live but the app isn't yet, turn a would-be silent duplicate into a unique-violation — which the old code's existing `.catch(() => {})` swallows exactly as silently as it already swallows every other transient failure today. Net effect for a respondent mid-survey during this window: **no visible change at all**, and if anything, slightly better data integrity (a rare race that used to silently create a duplicate row now silently keeps only the first write instead). This step is safe.
- **App deployed, migration not yet applied (the *old*, wrong ordering's intermediate state):** the new client code calls `upsert_nss_response` for every single answer. If that function doesn't exist yet, **every answer write fails**, the new retry-once logic retries into the same failure, and — unlike the old code — the new code surfaces this: `writeResponseWithRetry` sets a visible "your last answer may not have saved" banner after the retry also fails. This would be a real, visible regression for every respondent taking the survey during that window. This is the concrete reason the corrected order (migration first) matters, not just a theoretical preference.
- **Rollback:** because old app code never references the new function or index, and new app code only ever *reads* the migration's objects (never assumes a particular pre-existing data state), the migration and the app deploy can be rolled back independently:
  - If something is wrong with the **app** after deployment: revert to the previous application deployment. The migration can stay in place untouched — old code doesn't know or care that it exists. No database rollback needed in the common case.
  - If something is wrong with the **migration** itself (unexpected): roll back the app deployment first (back to old code, which doesn't need the new function), then drop the new objects (`drop function public.upsert_nss_response(...)`, `drop index public.nss_responses_submission_question_unique`) — in that order, since dropping the function while new app code is still live would reproduce the exact "every write fails" regression above.
  - In no scenario does a rollback need to touch or recompute any existing row in `nss_responses`/`nss_submissions` — this stays true throughout, consistent with §7.

## 6. Manual acceptance tests before releasing to respondents

Unchanged from phase 1 — still the right checklist to walk through in staging after the (now correctly-ordered) migration and app are both live there:

1. Standard answer → Back → same answer → Next: confirm no second network write fires, count unchanged.
2. Standard answer → Back → opposite answer: confirm one row in `nss_responses` for that question, count unchanged.
3. Standard → Back → It Depends → sharpened answer: confirm the stored row switches to `is_sharpened = true`, count unchanged.
4. It Depends → sharpened answer → Back: sharpened wording reappears with the answer marked.
5. It Depends → sharpened answer → Back → change answer: correction stored, no duplicate row.
6. It Depends → skip → Back: sharpened wording reappears with the skip indicator, no option marked.
7. Previously skipped → Back → decisive answer: count increments exactly once, row now stored.
8. Back across multiple answered questions → correction → chronological forward review: lands right after the corrected question, not back at the frontier.
9. Reload mid-survey → Back → review/correct: state survives, corrections still work afterward.
10. Rapid repeated clicks and clicking during the card transition: only one write occurs.
11. A correction right at the 21st/22nd question boundary: adaptive engine receives exactly one decisive answer for that question.
12. After several corrections, final scores and delivered-question count make sense (no inflation).

Also confirm: a genuinely new submission can complete all 50 questions and reach a report with the migration in place.

## 7. Remaining risks and limitations

- **Client-clock cross-device ordering** (§3d) is an accepted, out-of-scope limitation, not a bug — this app doesn't support concurrent cross-device survey-taking, and the clock-skew guard hardens against the realistic failure mode (a badly-wrong single clock) without pretending to solve true cross-device clock disagreement.
- **Skipped-question state only survives a reload on the same browser** (localStorage-only, never written server-side, by design) — unchanged from phase 1.
- **No test exercises an actual browser or a real Supabase REST/Auth layer.** Everything in §3/§4/§5a uses either a mocked Supabase client (faithful to the real call shapes, verified against what `api.ts`/`userProfiles.ts` actually call) or a direct `pg` connection standing in for PostgREST (verified faithful on the one place it mattered — `answered_at` coming back as an ISO string, not a JS `Date`, matching what the real REST API actually returns over JSON). A genuine two-tab-in-a-real-browser session, or any quirk specific to PostgREST/GoTrue themselves rather than the underlying Postgres function, would need an actual staging project or `supabase start` (Docker) to surface. This is the one category of thing that's structurally outside what local-only testing can reach, not something a different local approach would have closed.
- **`original_question_id`'s existing quirk is untouched**, per the original spec's explicit deprioritization — unchanged from phase 1.

## 8. Recommendation: Ready for Staging

**Ready for staging**, with no outstanding conditions on the database-concurrency or deployment-transition questions specifically — both are now proven locally, not just reasoned about: the advisory lock's real cross-session blocking behavior against genuinely concurrent Postgres connections (§3c), and a respondent's answers surviving the actual migration-then-deploy sequence using the real application code (§5a). Per your direction, no staging or cloud environment was created to get here — everything above runs in a temporary local process and leaves nothing behind. What staging is for now: confirming the actual deployed environment (real PostgREST, real Auth, a real browser) behaves the same way, and walking the respondent-experience checklist in §6/`NSS_Staging_Verification_Checklist.md` — not discovering whether the core mechanisms work, which is already settled.
