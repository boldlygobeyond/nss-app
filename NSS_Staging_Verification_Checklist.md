# NSS — Staging Verification Checklist

Purpose: confirm `NSS_Back_Navigation_And_Duplicate_Fix.md`'s implementation against a real staging Postgres/Supabase project before promoting to production.

**Update:** the two things this checklist originally existed to discover for the first time — the advisory lock's genuine concurrent-transaction behavior, and whether a respondent mid-survey loses answers across the migration-then-deploy transition — are now both already proven locally, without any staging environment, using a real temporary PostgreSQL server (`embedded-postgres`) and the actual application code. See `NSS_Back_Navigation_And_Duplicate_Fix.md` §3c and §5a. Sections B and C below are no longer "verify this works at all" — they're confirmatory passes on the actual deployed environment (real PostgREST, real Auth, a real browser), which the local tests can't reach since they don't run the full Supabase stack.

Default assumption going in: **don't make another implementation change unless one of these checks actually fails.** This is a verification pass, not a design review.

Run everything here against **staging**, with disposable test accounts/submissions. Never against production.

---

## A. Pre-flight

- [ ] Staging Supabase project identified and `.env`-equivalent pointed at it (not production).
- [ ] Current staging state recorded: is migration 0021 already applied? Is the new app code already deployed? (Determines which sections below you're starting from.)

---

## B. Database integrity — now a confirmatory pass, not first-time proof

Local testing already ran the real migration SQL against real Postgres and verified, for real: ownership checks, field validation, the clock-skew guard, stale-write rejection, pre-migration-row corrections, idempotent retries, the partial unique index, and — the thing that used to be the one gap — two genuinely concurrent database sessions actually blocking on the advisory lock as designed (`src/lib/nss/__tests__/upsertNssResponse.realConcurrency.test.ts`, run against a real temporary multi-connection PostgreSQL server, no staging needed). See `NSS_Back_Navigation_And_Duplicate_Fix.md` §3.

What's left for staging specifically: confirming the function **as actually deployed there** (via the Supabase migration/dashboard flow, not a test harness) behaves the same way — catching anything environment-specific (a different Postgres version, an extension that's missing, a permissions quirk) rather than discovering whether the design itself works.

### B1. Spot-check: two genuinely concurrent writes, same question, against the real deployed function

Optional but cheap, and worth doing once since this is the one piece that was hardest to get right. Two separate SQL connections open at the same time (Supabase SQL editor in two browser tabs, or `psql` in two terminals) — not two sequential queries in one connection.

1. Create one disposable test submission (note its `id` and the `user_id` it belongs to).
2. In **connection 1**: `begin;` then call `select public.upsert_nss_response(<submission_id>, 1, null, false, 'A', array['Recognition'], array['Connections'], now());` — but don't commit yet.
3. In **connection 2**, *while connection 1's transaction is still open*: run the same call for the same `(submission_id, question_id)` with selection `'B'`.
4. Expected (already proven locally — this just confirms staging's deployed copy matches): connection 2 blocks until connection 1 commits or rolls back.
5. Commit connection 1. Confirm connection 2 then proceeds and completes.
6. Query `nss_responses`: **exactly one row**.

- [ ] B1 matches the already-proven local behavior.
- [ ] If it does NOT — **stop and report back before touching anything else.** This would mean something about the *staging environment itself* differs from what was tested locally (not that the design is wrong — that part's settled), and that difference needs to be understood before production.

### B2. Everything else, spot-checked once against real staging Postgres (not re-deriving the local suite — just confirming nothing staging-specific differs)

- [ ] Field validation rejects a bad `selection`/mismatched clusters (one quick call is enough — this was already proven on real Postgres locally; just confirming staging's actual deployed function matches what's in the migration file).
- [ ] A manufactured stale write (older `answered_at` arriving "after" a newer stored one) is rejected.
- [ ] A write for someone else's `submission_id` (different `auth.uid()`) is rejected.

---

## C. The deployment transition itself — a respondent mid-survey when it happens

The core claim here — that migrating-then-deploying doesn't lose a respondent's answers — is now proven locally with real application code against a real database (`src/lib/nss/__tests__/deploymentTransition.realPg.test.ts`; see `NSS_Back_Navigation_And_Duplicate_Fix.md` §5a). What that couldn't reach: the actual browser, the actual PostgREST/Auth layer, and real network timing. This section is for that — a confirmatory, full-stack pass, not where the core mechanism gets tested for the first time.

Do this in staging with the **current staging state being "neither migration nor new app deployed yet"** (i.e., run this before B, or reset staging to that state first).

1. **Start a real session** in a browser: begin the survey, answer 3-4 questions normally. Do not close or reload the tab.
2. **With that tab still open and untouched**, apply the migration to staging (per `NSS_Back_Navigation_And_Duplicate_Fix.md` §5 step 2).
3. **Still without reloading that same tab**, answer 2-3 more questions in it. This tab is running the *old* app code against a database that now *has* the migration.
   - [ ] Each answer saves with no visible error (check the network tab or staging logs for the request to succeed — old code writes via plain delete-then-insert, not the new RPC, so this should be unaffected by the migration's new objects).
4. **Now deploy the new application code** to staging, with that same tab *still* open and untouched.
5. **Still without reloading**, answer one more question in that same (still old-JS) tab.
   - [ ] Still saves with no visible error — the already-loaded JS doesn't know a new deployment exists until the page reloads, so it should keep behaving exactly as it did in step 3.
6. **Now reload the tab.** This is the moment the respondent actually picks up the new code.
   - [ ] The survey resumes (not restarted) at the correct next question.
   - [ ] Every answer from steps 1, 3, and 5 is present and correct — check `nss_responses` directly for this submission: one row per question answered so far, no duplicates, no missing ones.
   - [ ] Click **Back** a few times through those pre-reload answers: standard wording restored correctly, previous selections marked. (These were written by the *old* code before the reload, so this also confirms the new code's resume/reconstruction path correctly reads old-shaped rows.)
   - [ ] Continue answering normally from here through a few more questions (now on the new code, new RPC path) — confirm these also save correctly and nothing from the pre-reload portion got disturbed.
7. **Finish the survey** (answer through to completion) and confirm a report generates with sane-looking scores.

- [ ] C passes end to end: no answer lost, no duplicate, no visible error, at any point in the transition — including the two "still on old code, but migration/deploy already happened underneath it" windows in steps 3 and 5, which is exactly the scenario "migration-first is safe" depends on actually holding up, not just being a reasonable-sounding argument.

---

## D. Respondent experience — the review/correction journeys

Same 12 journeys as `NSS_Back_Navigation_And_Duplicate_Fix.md` §6, run here against the now-staging-deployed (new) app + (new) migration, as the natural "does the finished state work" complement to the transition test in C:

- [ ] Standard answer → Back → same answer → Next: no second write, count unchanged.
- [ ] Standard answer → Back → opposite answer: one row, count unchanged.
- [ ] Standard → Back → It Depends → sharpened answer: row switches to sharpened, count unchanged.
- [ ] It Depends → sharpened answer → Back: sharpened wording + answer marked.
- [ ] It Depends → sharpened answer → Back → change answer: correction stored, no duplicate.
- [ ] It Depends → skip → Back: sharpened wording + skip indicator, nothing marked.
- [ ] Previously skipped → Back → decisive answer: count increments once, row now stored.
- [ ] Back across multiple answered questions → correction → chronological forward review (not a jump to the frontier).
- [ ] Reload mid-survey → Back → review/correct: state survives, corrections still work.
- [ ] Rapid repeated clicks / clicking during the card transition: only one write.
- [ ] A correction right at the 21st/22nd question boundary: adaptive engine gets exactly one decisive answer for that question.
- [ ] After several corrections, final scores and delivered-question count look right (no inflation).
- [ ] A genuinely new, uninterrupted submission completes all 50 and reaches a report.

---

## E. Sign-off

- [ ] All of B, C, and D pass.
- [ ] If anything failed: stop, write up exactly what was observed (not a guess at the cause), and only then decide whether it needs an implementation change — per the standing instruction not to jump back into code changes speculatively.
- [ ] Once this is fully green: proceed to the production deployment sequence in `NSS_Back_Navigation_And_Duplicate_Fix.md` §5, then start on the Survey Integrity section in Insights (ongoing visibility, as discussed) as the next piece of work.
