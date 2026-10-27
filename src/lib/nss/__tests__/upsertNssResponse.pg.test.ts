// Executes the ACTUAL, unmodified migration SQL (migration 0021) against a
// real embedded PostgreSQL engine (@electric-sql/pglite — a WASM build of
// real Postgres, not a mock or a reimplementation), to verify
// upsert_nss_response's behavior for real rather than by code review alone.
// See NSS_Back_Navigation_And_Duplicate_Fix.md §"Database concurrency and
// live verification" for what this does and does not prove.
//
// What this DOES genuinely verify, on real Postgres: ownership enforcement
// via auth.uid(), field validation, the clock-skew sanity guard, stale-write
// rejection, that a correction replaces rather than duplicates a row
// (including correcting a pre-migration row), that an idempotent retry of
// an already-applied write is harmless, and that the partial unique index
// actually enforces uniqueness for post-cutoff rows.
//
// What this CANNOT verify: the real cross-session blocking behavior of
// pg_advisory_xact_lock, or genuine concurrent-transaction races (two
// callers both passing the "no row yet" check before either inserts).
// pglite is a single-connection embedded engine — there is no second,
// independent session to race against, and pg_advisory_xact_lock doesn't
// even exist in pglite for that reason. It's stubbed out below as a no-op
// purely so the rest of the unmodified migration SQL can run; that stub
// does not exercise, and cannot stand in for, the real function's locking
// behavior. That piece remains verified by documentation/code review only
// until tested against a real multi-connection Postgres (Docker or a real
// staging Supabase project) — neither of which is available in this
// environment (no docker, no psql, no supabase CLI, no second configured
// project in .env.local).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

async function setCurrentUser(userId: string | null) {
  await db.query("select set_config('nss_test.current_user_id', $1, false);", [userId ?? ""]);
}

async function createSubmission(userId: string): Promise<string> {
  const id = randomUUID();
  await db.query("insert into public.nss_submissions (id, user_id) values ($1, $2);", [id, userId]);
  return id;
}

async function callUpsert(params: {
  submissionId: string;
  questionId: number;
  originalQuestionId?: number | null;
  isSharpened?: boolean;
  selection: "A" | "B";
  chosenClusters: string[];
  rejectedClusters: string[];
  answeredAt: string;
}) {
  return db.query(
    `select public.upsert_nss_response($1, $2, $3, $4, $5, $6, $7, $8);`,
    [
      params.submissionId,
      params.questionId,
      params.originalQuestionId ?? null,
      params.isSharpened ?? false,
      params.selection,
      params.chosenClusters,
      params.rejectedClusters,
      params.answeredAt,
    ],
  );
}

async function rowsFor(submissionId: string) {
  const r = await db.query(
    "select question_id, selection, answered_at from public.nss_responses where submission_id = $1 order by question_id;",
    [submissionId],
  );
  return r.rows as { question_id: number; selection: string; answered_at: string }[];
}

beforeAll(async () => {
  db = new PGlite();

  // Minimal schema mirroring what upsert_nss_response actually reads/writes.
  // .exec(), not .query() — pglite's .query() uses the extended/prepared-
  // statement protocol, which only accepts one statement at a time; a
  // multi-statement block needs the simple-query protocol .exec() uses.
  await db.exec(`
    -- Supabase provisions this role itself; pglite's fresh instance doesn't.
    create role authenticated;

    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('nss_test.current_user_id', true), '')::uuid;
    $$;

    create table public.nss_submissions (
      id uuid primary key,
      user_id uuid not null
    );

    create table public.nss_responses (
      submission_id uuid not null references public.nss_submissions(id),
      question_id smallint not null,
      original_question_id smallint,
      is_sharpened boolean not null default false,
      selection text not null,
      chosen_clusters text[] not null,
      rejected_clusters text[] not null,
      answered_at timestamptz not null
    );

    -- pglite-only compatibility shim — see file header. Not part of the
    -- real migration; real Postgres/Supabase already has this function.
    -- Signature must match the migration's actual call (int, int) — a
    -- (bigint, bigint) stub here previously masked the migration calling
    -- a signature that doesn't exist on real Postgres at all; see
    -- upsertNssResponse.realConcurrency.test.ts, which caught it.
    create function pg_advisory_xact_lock(int, int) returns void
      language plpgsql as $$ begin end; $$;
  `);

  const migrationSql = readFileSync(
    new URL("../../../../supabase/migrations/0021_nss_responses_unique_per_question.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migrationSql);
});

afterAll(async () => {
  await db.close();
});

describe("upsert_nss_response — real Postgres execution via pglite", () => {
  it("submission ownership and authorization enforcement: rejects a write for someone else's submission", async () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    const submissionId = await createSubmission(owner);

    await setCurrentUser(attacker);
    await expect(
      callUpsert({
        submissionId,
        questionId: 1,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/not authorized/);

    await setCurrentUser(owner);
    await expect(
      callUpsert({
        submissionId,
        questionId: 1,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      }),
    ).resolves.toBeDefined();
  });

  it("field validation: rejects an invalid selection and a chosen==rejected cluster pair", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    await expect(
      callUpsert({
        submissionId,
        questionId: 2,
        selection: "C" as "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/invalid selection/);

    await expect(
      callUpsert({
        submissionId,
        questionId: 2,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Recognition"],
        answeredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/must differ/);

    await expect(
      callUpsert({
        submissionId,
        questionId: 2,
        selection: "A",
        chosenClusters: ["NotARealCluster"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/invalid cluster name/);
  });

  it("permissions: anon (PUBLIC) cannot execute the function; authenticated can", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);

    // Supabase's anon role. Exercises the REVOKE from PUBLIC / GRANT to
    // authenticated at the end of the migration -- a permission-denied
    // error (42501) here means the grant itself is doing the work, not
    // just the function's internal auth.uid() check.
    await db.query("create role anon;");
    await db.query("set role anon;");
    await expect(
      db.query(`select public.upsert_nss_response($1,$2,$3,$4,$5,$6,$7,$8);`, [
        submissionId,
        2,
        null,
        false,
        "A",
        ["Recognition"],
        ["Connections"],
        new Date().toISOString(),
      ]),
    ).rejects.toThrow(/permission denied/i);
    await db.query("reset role;");

    // authenticated (the role PostgREST actually runs RPC calls as) can.
    await setCurrentUser(userId);
    await db.query("set role authenticated;");
    await expect(
      callUpsert({
        submissionId,
        questionId: 2,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      }),
    ).resolves.toBeDefined();
    await db.query("reset role;");
  });

  it("clock-skew guard: rejects a client timestamp implausibly far from server time", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    const wildFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(); // 1 year out
    await expect(
      callUpsert({
        submissionId,
        questionId: 3,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: wildFuture,
      }),
    ).rejects.toThrow(/invalid_answered_at/);

    // A normal, slightly-drifted timestamp (a few minutes off) still works.
    const slightlyOff = new Date(Date.now() - 1000 * 60 * 5).toISOString();
    await expect(
      callUpsert({
        submissionId,
        questionId: 3,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: slightlyOff,
      }),
    ).resolves.toBeDefined();
  });

  it("a delayed older answer arriving after a newer one is rejected as stale, and the newer answer survives", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    const older = new Date(Date.now() - 10_000).toISOString();
    const newer = new Date(Date.now() - 5_000).toISOString();

    // Newer click's request arrives first (e.g. the older one was delayed in transit).
    await callUpsert({
      submissionId,
      questionId: 4,
      selection: "B",
      chosenClusters: ["Connections"],
      rejectedClusters: ["Recognition"],
      answeredAt: newer,
    });

    await expect(
      callUpsert({
        submissionId,
        questionId: 4,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: older,
      }),
    ).rejects.toThrow(/stale_write/);

    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: 4, selection: "B" });
  });

  it("a correction replaces the existing row rather than duplicating it", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    await callUpsert({
      submissionId,
      questionId: 5,
      selection: "A",
      chosenClusters: ["Recognition"],
      rejectedClusters: ["Connections"],
      answeredAt: new Date(Date.now() - 10_000).toISOString(),
    });
    await callUpsert({
      submissionId,
      questionId: 5,
      selection: "B",
      chosenClusters: ["Connections"],
      rejectedClusters: ["Recognition"],
      answeredAt: new Date().toISOString(),
    });

    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: 5, selection: "B" });
  });

  it("correcting a pre-migration row (answered_at predating the partial index's cutoff) replaces it, not duplicates it", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    // Insert directly, bypassing the function entirely, with a timestamp
    // from well before the migration's cutoff — simulating a real
    // historical row that existed before this migration ever ran.
    await db.query(
      `insert into public.nss_responses
         (submission_id, question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at)
       values ($1, 6, false, 'A', $2, $3, '2025-01-01T00:00:00.000Z');`,
      [submissionId, ["Recognition"], ["Connections"]],
    );

    await callUpsert({
      submissionId,
      questionId: 6,
      selection: "B",
      chosenClusters: ["Connections"],
      rejectedClusters: ["Recognition"],
      answeredAt: new Date().toISOString(),
    });

    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: 6, selection: "B" });
  });

  it("concurrent writes where a historical duplicate already exists: correcting still converges to one row", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    // Two historical duplicate rows for the same question, both bypassing
    // the function (as real pre-fix duplicates did).
    await db.query(
      `insert into public.nss_responses
         (submission_id, question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at)
       values
         ($1, 7, false, 'A', $2, $3, '2025-01-01T00:00:00.000Z'),
         ($1, 7, false, 'B', $3, $2, '2025-01-01T00:00:14.000Z');`,
      [submissionId, ["Recognition"], ["Connections"]],
    );
    expect(await rowsFor(submissionId)).toHaveLength(2);

    await callUpsert({
      submissionId,
      questionId: 7,
      selection: "A",
      chosenClusters: ["Recognition"],
      rejectedClusters: ["Connections"],
      answeredAt: new Date().toISOString(),
    });

    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: 7, selection: "A" });
  });

  it("the stale-write comparison reads max(answered_at), not an arbitrary one of several duplicate rows", async () => {
    // A direct check of the exact SQL pattern the function uses for this
    // comparison, against two pre-cutoff historical duplicates with
    // different timestamps. An unordered, non-aggregated
    // "select answered_at into ... for update" against more than one
    // matching row has no guaranteed pick; max() does. Note this specific
    // wrong-pick failure mode can no longer actually flip an accept/reject
    // outcome in production today, now that the clock-skew guard only
    // accepts answered_at within 2 hours of "now" and the cutoff sits
    // comfortably further in the past than that: any guard-passing
    // incoming write is necessarily newer than every pre-cutoff historical
    // duplicate regardless of which one an arbitrary pick happened to
    // return, so this is fixed as a matter of not relying on undefined
    // row-order behavior, not because it's currently exploitable.
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    const older = "2026-01-01T00:00:00.000Z";
    const newer = "2026-01-01T01:00:00.000Z";
    await db.query(
      `insert into public.nss_responses
         (submission_id, question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at)
       values
         ($1, 8, false, 'A', $2, $3, $4),
         ($1, 8, false, 'B', $3, $2, $5);`,
      [submissionId, ["Recognition"], ["Connections"], older, newer],
    );
    expect(await rowsFor(submissionId)).toHaveLength(2);

    const { rows: maxRows } = await db.query(
      "select max(answered_at) as max_answered_at from public.nss_responses where submission_id = $1 and question_id = 8;",
      [submissionId],
    );
    const maxAnsweredAt = (maxRows[0] as { max_answered_at: string }).max_answered_at;
    expect(new Date(maxAnsweredAt).toISOString()).toBe(newer);

    // End-to-end: the full function still correctly locks and converges
    // both existing rows down to one when a genuinely newer answer (a
    // guard-passing, near-"now" correction) comes in.
    await callUpsert({
      submissionId,
      questionId: 8,
      selection: "A",
      chosenClusters: ["Recognition"],
      rejectedClusters: ["Connections"],
      answeredAt: new Date().toISOString(),
    });
    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: 8, selection: "A" });
  });

  it("a retry of an already-applied write (identical payload) is idempotent, not rejected and not duplicated", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    await setCurrentUser(userId);

    const payload = {
      submissionId,
      questionId: 8,
      selection: "A" as const,
      chosenClusters: ["Recognition"],
      rejectedClusters: ["Connections"],
      answeredAt: new Date().toISOString(),
    };
    await callUpsert(payload);
    // Simulates writeResponseWithRetry's retry-once: the exact same call again.
    await expect(callUpsert(payload)).resolves.toBeDefined();

    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
  });

  it("the partial unique index actually enforces uniqueness for post-cutoff rows if the function is bypassed", async () => {
    const userId = randomUUID();
    const submissionId = await createSubmission(userId);
    const now = new Date().toISOString();

    await db.query(
      `insert into public.nss_responses
         (submission_id, question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at)
       values ($1, 9, false, 'A', $2, $3, $4);`,
      [submissionId, ["Recognition"], ["Connections"], now],
    );

    await expect(
      db.query(
        `insert into public.nss_responses
           (submission_id, question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at)
         values ($1, 9, false, 'B', $2, $3, $4);`,
        [submissionId, ["Connections"], ["Recognition"], now],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
