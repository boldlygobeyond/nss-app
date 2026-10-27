# NSS — Survey Integrity Panel

Status: **implemented and tested locally. Not deployed. No production data touched — this feature is entirely read-only.**

A compact, collapsible "Survey Integrity" section on each respondent's admin Insights page (`/admin/reports/[id]/insights`), letting BGB admins quickly check whether a submission's stored data looks internally consistent — especially relevant now that the Back-navigation/duplicate-prevention fix (`NSS_Back_Navigation_And_Duplicate_Fix.md`) is live in production and both old (pre-fix) and new (post-fix) submissions exist side by side.

## 1. Checks implemented

All four checks run from two lightweight, already-admin-gated queries (see §4) — nothing is computed per the whole respondent list, only for the one submission being viewed.

### Decisive answers
- Counts distinct `question_id`s via `latestResponsePerQuestion` (`responseDedup.ts`) — the exact same dedup rule scoring itself uses, not a separately-invented definition of "decisive."
- Completed submission: expects 50, shown as `count / 50`.
- In-progress submission: shown as `count` with no fixed target (not treated as a failure).
- Flags a **mismatch** whenever the submission's own `questions_answered` column disagrees with the actual distinct-decisive-answer count computed right now — this is the check most likely to catch a real historical accounting bug (e.g., a pre-fix duplicate click that inflated the stored counter). A mismatch is surfaced as an issue regardless of completion state, not hidden behind "still in progress."

### Duplicate question records
- Groups **raw** `nss_responses` rows (before any dedup) by `question_id`; any group with more than one row is a duplicate.
- Classified against the migration 0021 cutoff (`2026-10-20T00:00:00.000Z`, exported as `MIGRATION_CUTOFF`): a group where every row predates the cutoff is **historical**; a group with any row at or after it is **new** and far more concerning, since the DB-level fix should prevent that going forward.
- Never hidden because scoring already knows how to pick one of them — any duplicate group at all marks this check as an issue, with historical vs. new counted and labeled separately in the detail view.
- Nothing is deleted, merged, or modified by this check or by viewing it.

### Calibration coverage
- Walks `nss_submissions.question_sequence` — what was actually **presented** (including a question the respondent then skipped) — never the responses table, which would silently make a legitimately-skipped calibration question look like a coverage gap.
- If fewer than 21 entries are recorded: **incomplete** while the submission is still `in_progress` (expected, not a failure), but **issue** if the submission is already marked complete (a real inconsistency — a finished survey must have gone through all 21).
- If 21+ are recorded: looks up each of the first 21 question ids' `cluster_a`/`cluster_b` and checks all 21 possible cluster-pair combinations are covered. Missing pairs are listed by name if any.
- If any of those 21 ids no longer resolve in `nss_questions` (bank changed since): **unable to verify**, not a guess.

### Scoring consistency
- Does **not** re-run Bradley-Terry fitting or compare rankings — the task explicitly didn't want that, and it isn't actually possible to do meaningfully: `top_needs`/`scores` are a one-time snapshot written at survey completion (`SurveyClient.tsx`'s `finishSurvey`), never recomputed on page view, so there is no live "second scoring method" to agree or disagree with here.
- What it **can** establish: whether a scoring result exists at all for a submission marked complete (missing → issue), and whether the decisive-answer accounting it would have been built from currently looks consistent (if the decisive-answers check found a mismatch, scoring is marked **unable to verify** rather than pass or fail, since the input count itself is in question).
- A clean pass only means: a complete, internally-consistent answer set and a stored result both exist — not that the ranking itself has been independently re-verified.

## 2. UI

Added to `src/app/admin/reports/[id]/insights/page.tsx`, as one more `<section>` in the existing card-stack layout (same `bg-card border border-border/50 rounded-2xl p-5` style as the other sections), placed right after the existing "had more than one stored response" banner and before the stats grid.

**Collapsed header** (always visible): "Survey Integrity" + a colored status pill — green **Passed**, red **Issues detected**, neutral **Incomplete**, amber **Unable to verify** — with a chevron to collapse/expand. Open by default.

**Expanded body:** a compact 4-up grid (`Decisive answers: 50 / 50` · `Duplicate records: 0` · `Calibration coverage: 21 / 21` · `Scoring consistency: Passed`), followed by detail lines that only render when relevant:
- A red line if the decisive-answer count disagrees with the stored counter.
- If duplicates exist: a one-line historical/new split, then small chips per affected question (`Q5 ×2`), red-bordered for new ones, neutral for historical — hovering a chip shows its raw timestamps.
- If calibration pairs are missing: the specific missing pairs, listed by name.
- The scoring check's own explanatory note (always shown — including explaining what a "pass" does and doesn't mean).

No large dashboard, no raw-event viewer, no technical jargon beyond what the task itself specified. I didn't capture a live screenshot — this environment has no authenticated admin browser session to drive one against; the description above matches the actual JSX and Tailwind classes committed, reviewable directly by loading the page.

## 3. Historical vs. new submissions

Handled exactly as specified: a submission with only historical duplicates still shows **Issues detected** (never silently downgraded to Passed just because the issue is old) — the panel's job is to report true state, not to imply something was fixed that wasn't. The duplicate detail explicitly labels which rows are historical ("pre-fix, before [cutoff date]") vs. new. Nothing in this feature deletes, merges, recalculates, or regenerates anything — every query is a `select`.

"No issues found" vs. "all checks verified" is a real, visible distinction: `overallStatus` is only ever `"passed"` when **every** check both ran successfully and found nothing wrong; if even one check comes back `unable_to_verify` (e.g., calibration's question-bank lookup failed) while the others are clean, the overall status is `"unable_to_verify"`, not `"passed"` — a clean result on 3 of 4 checks is never presented as a full pass.

## 4. Security and performance

- **No new migration, no new RLS policy, no new API route.** `computeSurveyIntegrity` (`src/lib/nss/surveyIntegrity.ts`) takes the caller's own authenticated Supabase client — the same one `computeInsightsData` already uses on this same page — and runs two `select` queries (`nss_submissions`, plus `nss_questions` only when calibration coverage needs it). Real authorization is the existing Postgres RLS policy `nss_submissions_select_own_or_admin` / `nss_responses_select_via_submission` (`0001_init_schema.sql`): a non-admin caller gets RLS-filtered (empty) results, not someone else's data, regardless of anything in this module.
- The page's existing client-side `role !== "admin"` gate (already present, unchanged) is the UX fast-fail on top of that — this feature adds nothing new to audit here, it just runs inside the same already-gated branch.
- Scoped to one submission at a time, not the whole respondent list — nothing bulk-loads every submission's full response history.
- `computeSurveyIntegrity` never calls `.insert()`/`.update()`/`.delete()`/`.upsert()`/`.rpc()` — enforced structurally by the test suite, not just by code review (see below).

## 5. Test results

`src/lib/nss/__tests__/surveyIntegrity.test.ts` — **10/10 passing**, against a mocked Supabase client whose write methods (`insert`/`update`/`delete`/`upsert`/`rpc`) throw if called at all, so a read-only regression would fail every test, not just one:

1. Clean completed submission — all four checks pass, overall `passed`.
2. In-progress submission — overall `incomplete`, but calibration coverage can independently show `pass` once calibration itself is actually done (tests that the two aren't conflated).
3. Historical duplicate records — `issue`, correctly classified `isHistorical: true`.
4. Post-migration duplicate records — `issue`, correctly classified `isHistorical: false` (tested right at the cutoff instant itself, inclusive).
5. Missing/incomplete calibration evidence — two sub-cases: a completed submission with a too-short sequence (`issue`, not merely incomplete), and delivered ids that no longer resolve in the question bank (`unable_to_verify`).
6. Scoring-input mismatch — stored `questions_answered` disagreeing with the real decisive count produces both a decisive-answers `issue` and a scoring `unable_to_verify`, with overall `issues_detected`.
7. Unauthorized access — an RLS-filtered (empty) submission row returns `null`, not an error or partial data.
8. Unavailable/malformed diagnostic data — a query error on the responses table returns `null` rather than throwing or guessing.
9. An explicit "never writes" check (on top of every other test implicitly proving the same thing by not throwing).

Combined with the rest of the suite: **`npm test` → 9 files, 64 tests, all passing.** `npx tsc --noEmit`, `npx eslint`, and `npm run build` all pass clean (one pre-existing, unrelated `pairKeyOf` unused-variable warning on the same page file, present before this change).

## 6. Limitations and what's currently unverifiable

- **No live browser/screenshot verification** — only automated tests and a manual read of the rendered JSX. Should be visually reviewed once pulled up.
- **A submission with zero progress won't show the panel at all.** The Insights page has a pre-existing early return (`if (!data) return <"no journey yet">`) that triggers before the integrity section would ever render, for a submission whose `question_sequence` is still null. `computeSurveyIntegrity` itself handles this fine (would show `incomplete` across the board), but the page's own existing branching never reaches it in that one case. Not fixed here, since it would mean restructuring an existing, unrelated code path — flagged instead.
- **Scoring consistency is a best-effort check, not independent re-verification**, by design — see §1. It cannot and does not confirm the stored ranking is numerically correct, only that a result exists and the input count it would have used looks sane.
- **A skip occurring as literally the last action before a respondent abandons the survey entirely** could theoretically not be flushed to `question_sequence` (the debounced sync is keyed off `[tally, questionsAnswered, ...]`, which a skip alone doesn't change) — a narrow, pre-existing property of how `question_sequence` syncs, not something this feature introduces or can detect.
- Calibration coverage's "unable to verify" path (stale question ids) hasn't been exercised against a real historical submission, only via the mocked test — plausible but not observed live.

## 7. Files changed

| File | What |
|---|---|
| `src/lib/nss/surveyIntegrity.ts` | **New.** `computeSurveyIntegrity` and all four checks. |
| `src/lib/nss/__tests__/surveyIntegrity.test.ts` | **New.** 10 tests, including the write-call trap. |
| `src/app/admin/reports/[id]/insights/page.tsx` | Added the integrity fetch (parallel with the existing insights fetch), state, status styling constants, and the new collapsible section's JSX. No existing behavior changed. |

## 8. Migration / permissions required

**None.** No new migration, no new RLS policy, no new grant, no new API route — everything runs through infrastructure that already exists and is already admin-gated.
