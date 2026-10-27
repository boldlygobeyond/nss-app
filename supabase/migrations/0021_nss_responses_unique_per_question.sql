-- Prevents more than one stored response per (submission, question) going
-- forward. See NSS_Back_Navigation_And_Duplicate_Fix.md for the full
-- investigation and design history, including an earlier draft of this
-- migration that used
-- ON CONFLICT and was found (correctly, by review) not to work the way it
-- needed to for pre-migration submissions. This version does not use
-- ON CONFLICT at all.
--
-- This migration never reads, deletes, or modifies a single existing row.
-- It only adds new schema objects (an index, a function, a grant).

-- ── Partial unique index ─────────────────────────────────────────────────
-- A plain UNIQUE constraint can't be added here — Postgres validates it
-- against every existing row at creation time, and real data already
-- contains historical duplicates. This index is partial, scoped to rows
-- answered at or after the cutoff below, so it only ever governs writes
-- from this point forward; every existing row is left exactly as it is.
--
-- Its role in this design is narrower than an upsert's ON CONFLICT
-- arbiter: upsert_nss_response() below does its own explicit
-- delete-then-insert within one transaction, which already handles the
-- single-request case (including correcting a pre-migration row, whose
-- answered_at predates the cutoff and so isn't covered by this index at
-- all — the function's DELETE matches on submission_id+question_id
-- directly, not through this index, so that's fine). This index exists
-- as a true database-level backstop against two genuinely CONCURRENT
-- calls to the function (e.g. two browser tabs, or a retried request
-- racing a fresh one) both committing an insert for the same question —
-- without it, two concurrent transactions could each delete-then-insert
-- without ever seeing each other's row. Every row the function ever
-- inserts gets answered_at = (a client-supplied, click-time) timestamp
-- that is always >= this cutoff, so this index always covers new writes.
--
-- Cutoff choice: must be (a) after every existing historical-duplicate
-- row (confirmed via a read-only production query — the latest is
-- 2026-09-25; nothing from the actual app is anywhere near this date) and
-- (b) far enough in the past that it can never overlap with the
-- function's own clock-skew guard's accepted window (p_answered_at as
-- old as `clock_timestamp() - interval '2 hours'`, see below) at any
-- plausible time this migration actually gets applied — a value set to
-- "now" at authoring time came within about 3 hours of that overlap
-- happening for real by the time of deployment, which is exactly the
-- fragility this margin is meant to rule out.
create unique index nss_responses_submission_question_unique
  on public.nss_responses (submission_id, question_id)
  where answered_at >= '2026-10-20T00:00:00.000Z';

-- ── Atomic, validated, ownership-checked write ──────────────────────────
-- SECURITY DEFINER (same pattern as get_subordinate_emails/is_manager/
-- get_team_profiles in earlier migrations) means this function bypasses
-- nss_responses' row-level policies, so it re-implements the same
-- ownership check those policies would otherwise enforce, explicitly, as
-- its first statement.
--
-- Stale-write protection: p_answered_at is the RESPONDENT'S click time,
-- captured client-side at the moment they chose an answer — not whenever
-- this request happens to reach the server. If a response already stored
-- for this question has a *later* answered_at than the incoming write,
-- this request is an older, delayed one arriving after a more recent,
-- more authoritative answer already landed (e.g. a slow network retry
-- racing a fresh click) — it's rejected rather than silently overwriting
-- the newer intentional answer.
--
-- Concurrency: `select ... for update` only locks a row that already
-- EXISTS. Two concurrent first-time writes for the same question (no row
-- yet) both pass that select with nothing to lock, then both proceed to
-- insert — the partial unique index would catch that as a unique
-- violation on whichever commits second, but as an unhandled constraint
-- error, not as a clean, retriable outcome, and it does nothing for two
-- concurrent *corrections* racing each other before either's delete runs.
-- A transaction-scoped advisory lock, keyed on (submission_id,
-- question_id) and acquired *before* the existence check, closes this:
-- it serializes every concurrent call for the same key regardless of
-- whether a row exists yet, is automatically released at transaction end
-- (commit or rollback — no separate unlock, no risk of holding it past
-- this call), and two different keys never block each other, so answering
-- different questions concurrently (e.g. two tabs on different questions)
-- is unaffected. hashtext(p_submission_id::text) and p_question_id are
-- passed as the two independent lock-key components — the two-INTEGER-key
-- form of pg_advisory_xact_lock(int, int), not the single-bigint-key form
-- — rather than hashing both into one key, so a collision would require
-- the submission hash AND the exact question_id to both coincide, not
-- just a single combined hash. (An earlier draft used
-- hashtextextended(...)/bigint casts, matching no real overload of this
-- function at all — pg_advisory_xact_lock only has a single-bigint form
-- and a two-INTEGER form, never (bigint, bigint); caught by testing
-- against a real, unstubbed Postgres rather than the embedded pglite
-- engine used elsewhere, which doesn't implement this function and so
-- had to have it stubbed out, masking the mismatch. See
-- NSS_Back_Navigation_And_Duplicate_Fix.md §3.)
create function public.upsert_nss_response(
  p_submission_id uuid,
  p_question_id smallint,
  p_original_question_id smallint,
  p_is_sharpened boolean,
  p_selection text,
  p_chosen_clusters text[],
  p_rejected_clusters text[],
  p_answered_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_answered_at timestamptz;
begin
  if not exists (
    select 1 from public.nss_submissions
    where id = p_submission_id and user_id = auth.uid()
  ) then
    raise exception 'not authorized to write a response for this submission';
  end if;

  if p_selection not in ('A', 'B') then
    raise exception 'invalid selection: %', p_selection;
  end if;
  if coalesce(array_length(p_chosen_clusters, 1), 0) <> 1
     or coalesce(array_length(p_rejected_clusters, 1), 0) <> 1 then
    raise exception 'chosen_clusters and rejected_clusters must each have exactly one element';
  end if;
  if p_chosen_clusters[1] = p_rejected_clusters[1] then
    raise exception 'chosen and rejected cluster must differ';
  end if;

  -- The existing nss_questions FK on question_id already rejects a
  -- nonexistent question (0001_init_schema.sql). That doesn't cover these
  -- cluster-name arrays at all, though — they're a plain text[] column
  -- with no FK/enum of their own, so without this check any string would
  -- be accepted and written straight into Bradley-Terry's scoring input.
  -- This closes that off to the 7 known cluster names (clusters.ts's
  -- CLUSTERS). It does NOT verify these two clusters are the actual pair
  -- this specific question_id maps to — that would need a lookup against
  -- nss_questions.cluster_a/cluster_b and is a materially bigger change
  -- than this migration's approved scope; today's legitimate client
  -- always derives both values from the same question object already, so
  -- this is a pre-existing trust-boundary property, not a regression
  -- introduced here, and is called out as such in the final assessment.
  if p_chosen_clusters[1] not in
       ('Agency', 'Belonging', 'Stability', 'Ecosystem', 'Connections', 'Purpose', 'Recognition')
     or p_rejected_clusters[1] not in
       ('Agency', 'Belonging', 'Stability', 'Ecosystem', 'Connections', 'Purpose', 'Recognition') then
    raise exception 'invalid cluster name: % / %', p_chosen_clusters[1], p_rejected_clusters[1];
  end if;

  -- p_answered_at is the respondent's own device clock, not the server's —
  -- deliberately, so a delayed network retry of an older click can be told
  -- apart from a fresher one by actual click order, not by when the
  -- request happened to reach the server (server arrival order can easily
  -- be the reverse of real click order). That's reliable for the dominant
  -- real case, a single device's own requests racing each other, because
  -- those timestamps only ever get compared against each other, never
  -- against a different device's clock. It is NOT reliable for two
  -- genuinely different devices/sessions writing concurrently with
  -- disagreeing clocks — there's no way to recover true ordering between
  -- two untrusted clocks after the fact, and this app doesn't support
  -- (or expect) taking the survey on two devices at once, so that's an
  -- accepted limitation, not something this guards against. What IS
  -- guarded here: a client whose clock is grossly wrong (wrong year, a
  -- bug sending an invalid/epoch value) would otherwise poison every
  -- future stale-write comparison for that submission for as long as the
  -- bad value sits in the table — rejecting it outright, loudly, rather
  -- than silently accepting it, means that failure surfaces immediately
  -- as a write error instead of quietly corrupting ordering later.
  -- The backward-direction bound is tighter (2 hours, not 1 day) than the
  -- forward one. A real client only ever needs to tolerate ordinary
  -- clock drift/timezone confusion here, not a full day — nothing in
  -- this app queues an answer offline for hours before sending it. The
  -- forward direction stays generous because it's the dangerous one: a
  -- clock skewed into the future poisons every later comparison for that
  -- submission for as long as the bad value sits in the table, so it's
  -- worth erring toward catching it even on a milder skew. A tight
  -- backward bound also keeps this guard's accepted window comfortably
  -- clear of the partial index's cutoff above, for as long as this
  -- migration might sit before being applied.
  if p_answered_at > clock_timestamp() + interval '1 day'
     or p_answered_at < clock_timestamp() - interval '2 hours' then
    raise exception 'invalid_answered_at: client timestamp % is implausibly far from server time', p_answered_at
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_submission_id::text), p_question_id::int);

  -- Locks every existing row for this key, not just one -- there can be
  -- more than one if a historical, pre-fix duplicate still exists for
  -- this exact question (confirmed: 15 such groups exist in production
  -- today). FOR UPDATE can't be combined with an aggregate in the same
  -- query, so the lock and the max() read below are two statements; both
  -- run under the advisory lock already held above, so there's no race
  -- between them.
  perform 1
  from public.nss_responses
  where submission_id = p_submission_id and question_id = p_question_id
  for update;

  -- max(), not a bare, unordered "select ... into" -- if more than one
  -- row already exists for this key (a historical duplicate), an
  -- unordered multi-row SELECT INTO has no guaranteed row order and
  -- could silently compare against whichever duplicate happens to come
  -- back first rather than the actually most recent one, wrongly
  -- *accepting* a write that should have been rejected as stale against
  -- the true latest existing answer.
  select max(answered_at) into v_existing_answered_at
  from public.nss_responses
  where submission_id = p_submission_id and question_id = p_question_id;

  if v_existing_answered_at is not null and v_existing_answered_at > p_answered_at then
    raise exception 'stale_write: a more recent answer already exists for this question'
      using errcode = 'P0001';
  end if;

  delete from public.nss_responses
  where submission_id = p_submission_id and question_id = p_question_id;

  insert into public.nss_responses (
    submission_id, question_id, original_question_id, is_sharpened,
    selection, chosen_clusters, rejected_clusters, answered_at
  )
  values (
    p_submission_id, p_question_id, p_original_question_id, p_is_sharpened,
    p_selection, p_chosen_clusters, p_rejected_clusters, p_answered_at
  );
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default — that
-- includes Supabase's `anon` role, not just `authenticated`. The
-- function's own auth.uid() check already rejects an anonymous caller
-- (auth.uid() is null for one, so the ownership `exists(...)` is always
-- false), so this was never actually exploitable, but it's not something
-- to rely on instead of the grant itself: revoke the implicit PUBLIC
-- grant explicitly, then grant only to authenticated, matching
-- least-privilege rather than leaning entirely on internal logic.
revoke execute on function public.upsert_nss_response(
  uuid, smallint, smallint, boolean, text, text[], text[], timestamptz
) from public;

grant execute on function public.upsert_nss_response(
  uuid, smallint, smallint, boolean, text, text[], text[], timestamptz
) to authenticated;
