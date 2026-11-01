// Executes the ACTUAL, unmodified NRS migration SQL (0022-0027) against a
// real embedded PostgreSQL engine (@electric-sql/pglite), mirroring
// upsertNssResponse.pg.test.ts's approach for upsert_nss_response.
//
// What this DOES genuinely verify, on real Postgres: access-token
// ownership enforcement, rating validation, that a question must be part
// of the submission's team's saved scenario selection (not just share its
// cluster — 0027), that re-answering a question updates in place rather
// than duplicating, that a completed submission's responses are
// immutable, that team_roster's on delete restrict actually blocks
// removing a roster member with NRS history, the anon/authenticated
// execute grants, and nrs_team_cluster_scenarios' own invariants (exactly
// 10 distinct ids, all belonging to the stated cluster — 0025).
//
// What this CANNOT verify: real cross-session concurrent-transaction
// races — pglite is a single-connection embedded engine, and
// pg_advisory_xact_lock doesn't exist in pglite, so it's stubbed out
// below as a no-op purely so the rest of the unmodified migration SQL can
// run. That stub does not exercise the real function's locking behavior.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
let teamId: string;

async function createRoster(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.team_roster (id, team_id, first_name, last_name, email, manager_email)
     values ($1, $2, 'Test', 'User', $3, 'manager@example.com');`,
    [id, teamId, `${id}@example.com`],
  );
  return id;
}

async function createSubmission(rosterId: string, clusterKey = "Stability"): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = randomUUID();
  await db.query(
    `insert into public.nrs_submissions (id, roster_id, cluster_key, access_token) values ($1, $2, $3, $4);`,
    [id, rosterId, clusterKey, token],
  );
  return { id, token };
}

async function callUpsert(params: { submissionId: string; token: string; questionId: number; rating: number }) {
  return db.query(`select public.upsert_nrs_response($1, $2, $3, $4);`, [
    params.submissionId,
    params.token,
    params.questionId,
    params.rating,
  ]);
}

async function rowsFor(submissionId: string) {
  const r = await db.query(
    "select question_id, rating from public.nrs_responses where submission_id = $1 order by question_id;",
    [submissionId],
  );
  return r.rows as { question_id: number; rating: number }[];
}

async function statusOf(submissionId: string): Promise<string> {
  const r = await db.query("select status from public.nrs_submissions where id = $1;", [submissionId]);
  return (r.rows[0] as { status: string }).status;
}

beforeAll(async () => {
  db = new PGlite();

  // Minimal schema mirroring what the NRS migrations actually read/write —
  // same approach as upsertNssResponse.pg.test.ts.
  await db.exec(`
    create role authenticated;
    create role anon;

    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select null::uuid;
    $$;

    create table public.user_profiles (
      id uuid primary key,
      role text not null default 'user'
    );

    create function public.is_admin() returns boolean language sql stable as $$
      select false;
    $$;

    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end;
    $$;

    create table public.teams (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null unique,
      created_at timestamptz not null default now()
    );

    create table public.team_roster (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null references public.teams (id) on delete cascade,
      first_name text not null,
      last_name text not null,
      email text not null,
      manager_email text not null,
      invited_at timestamptz,
      created_at timestamptz not null default now(),
      unique (team_id, email)
    );

    -- pglite-only compatibility shim — see file header. Signature must
    -- match the migration's actual call (int, int), same precedent as
    -- upsertNssResponse.pg.test.ts.
    create function pg_advisory_xact_lock(int, int) returns void
      language plpgsql as $$ begin end; $$;
  `);

  const migrationsDir = new URL("../../../../supabase/migrations/", import.meta.url);
  for (const file of [
    "0022_nrs_schema.sql",
    "0023_seed_nrs_core_stability.sql",
    "0024_nrs_upsert_response.sql",
    "0025_nrs_team_cluster_scenarios.sql",
    "0026_nrs_scenario_bank_import.sql",
    "0027_nrs_upsert_response_scoped_to_selection.sql",
  ]) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    await db.exec(sql);
  }

  teamId = randomUUID();
  await db.query(`insert into public.teams (id, name, slug) values ($1, 'Test Team', $2);`, [
    teamId,
    `test-team-${teamId}`,
  ]);
  // Every existing test in this file answers questions 1-10 (Stability) —
  // give this harness's one shared team a selection covering exactly
  // those, same shape as 0026's own seeding for the real pilot teams.
  await db.query(
    `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
     values ($1, 'Stability', array[1,2,3,4,5,6,7,8,9,10]::smallint[]);`,
    [teamId],
  );
});

afterAll(async () => {
  await db.close();
});

describe("upsert_nrs_response — real Postgres execution via pglite", () => {
  it("rejects a write with the wrong access token", async () => {
    const rosterId = await createRoster();
    const { id: submissionId } = await createSubmission(rosterId);

    await expect(
      callUpsert({ submissionId, token: "wrong-token", questionId: 1, rating: 3 }),
    ).rejects.toThrow(/not authorized/);
  });

  it("rejects a rating outside 1-5", async () => {
    const rosterId = await createRoster();
    const { id: submissionId, token } = await createSubmission(rosterId);

    await expect(callUpsert({ submissionId, token, questionId: 1, rating: 0 })).rejects.toThrow(/invalid rating/);
    await expect(callUpsert({ submissionId, token, questionId: 1, rating: 6 })).rejects.toThrow(/invalid rating/);
  });

  it("rejects a question that isn't part of the team's saved selection", async () => {
    const rosterId = await createRoster();
    const { id: submissionId, token } = await createSubmission(rosterId);

    // Question 11 is a real Stability scenario (0026 imports 30 per
    // cluster) but isn't one of this harness's selected 10 (1-10) — the
    // check must be against the selection, not mere cluster membership.
    await expect(callUpsert({ submissionId, token, questionId: 11, rating: 3 })).rejects.toThrow(
      /is not part of this team's selected scenarios/,
    );
    // A question id that doesn't exist at all is rejected the same way.
    await expect(callUpsert({ submissionId, token, questionId: 999, rating: 3 })).rejects.toThrow(
      /is not part of this team's selected scenarios/,
    );
  });

  it("re-answering a question updates the existing row in place, not a duplicate, and flips status to in_progress", async () => {
    const rosterId = await createRoster();
    const { id: submissionId, token } = await createSubmission(rosterId);

    expect(await statusOf(submissionId)).toBe("invited");

    await callUpsert({ submissionId, token, questionId: 1, rating: 2 });
    expect(await statusOf(submissionId)).toBe("in_progress");

    await callUpsert({ submissionId, token, questionId: 1, rating: 5 });

    const rows = await rowsFor(submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question_id: 1, rating: 5 });
  });

  it("rejects any write once the submission is completed", async () => {
    const rosterId = await createRoster();
    const { id: submissionId, token } = await createSubmission(rosterId);

    await callUpsert({ submissionId, token, questionId: 1, rating: 3 });
    await db.query(`update public.nrs_submissions set status = 'completed' where id = $1;`, [submissionId]);

    await expect(callUpsert({ submissionId, token, questionId: 2, rating: 4 })).rejects.toThrow(
      /already completed/,
    );
  });

  it("permissions: an unprivileged role cannot execute the function; anon and authenticated can", async () => {
    const rosterId = await createRoster();
    const { id: submissionId, token } = await createSubmission(rosterId);

    await db.query("create role nobody;");
    await db.query("set role nobody;");
    await expect(
      db.query(`select public.upsert_nrs_response($1, $2, $3, $4);`, [submissionId, token, 1, 3]),
    ).rejects.toThrow(/permission denied/i);
    await db.query("reset role;");

    await db.query("set role anon;");
    await expect(callUpsert({ submissionId, token, questionId: 1, rating: 3 })).resolves.toBeDefined();
    await db.query("reset role;");

    await db.query("set role authenticated;");
    await expect(callUpsert({ submissionId, token, questionId: 1, rating: 4 })).resolves.toBeDefined();
    await db.query("reset role;");
  });

  it("duplicate submissions are prevented at the DB level: a second row for the same roster member + cluster is rejected", async () => {
    const rosterId = await createRoster();
    await createSubmission(rosterId);

    await expect(
      db.query(`insert into public.nrs_submissions (roster_id, cluster_key, access_token) values ($1, 'Stability', $2);`, [
        rosterId,
        randomUUID(),
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("removing a roster member with NRS history is blocked (on delete restrict), not cascaded", async () => {
    const rosterId = await createRoster();
    await createSubmission(rosterId);

    await expect(db.query(`delete from public.team_roster where id = $1;`, [rosterId])).rejects.toThrow(
      /violates RESTRICT setting of foreign key constraint/i,
    );

    // A roster member with NO NRS history is still removable as before.
    const untouchedRosterId = await createRoster();
    await expect(db.query(`delete from public.team_roster where id = $1;`, [untouchedRosterId])).resolves.toBeDefined();
  });
});

describe("nrs_team_cluster_scenarios — real Postgres execution via pglite", () => {
  async function freshTeam(): Promise<string> {
    const id = randomUUID();
    await db.query(`insert into public.teams (id, name, slug) values ($1, 'Another Team', $2);`, [
      id,
      `another-team-${id}`,
    ]);
    return id;
  }

  it("rejects fewer or more than 10 question ids", async () => {
    const otherTeamId = await freshTeam();
    // Caught by the trigger's own distinct-count check (it runs before
    // the CHECK constraint ever gets evaluated) — the CHECK constraint
    // still exists as a backstop for anything that bypasses triggers.
    await expect(
      db.query(
        `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
         values ($1, 'Stability', array[1,2,3]::smallint[]);`,
        [otherTeamId],
      ),
    ).rejects.toThrow(/exactly 10 distinct values/);

    await expect(
      db.query(
        `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
         values ($1, 'Stability', array[1,2,3,4,5,6,7,8,9,10,11]::smallint[]);`,
        [otherTeamId],
      ),
    ).rejects.toThrow(/exactly 10 distinct values/);
  });

  it("rejects duplicate ids within the array, even though the count is 10", async () => {
    const otherTeamId = await freshTeam();
    await expect(
      db.query(
        `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
         values ($1, 'Stability', array[1,1,2,3,4,5,6,7,8,9]::smallint[]);`,
        [otherTeamId],
      ),
    ).rejects.toThrow(/exactly 10 distinct values/);
  });

  it("rejects a question id that belongs to a different cluster than the one stated", async () => {
    const otherTeamId = await freshTeam();
    // Question 31 is a real id (Belonging, per 0026), not Stability.
    await expect(
      db.query(
        `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
         values ($1, 'Stability', array[1,2,3,4,5,6,7,8,9,31]::smallint[]);`,
        [otherTeamId],
      ),
    ).rejects.toThrow(/must belong to cluster/);
  });

  it("accepts any valid combination of 10 distinct ids from the stated cluster, and upserts cleanly on conflict", async () => {
    const otherTeamId = await freshTeam();
    await db.query(
      `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
       values ($1, 'Belonging', array[31,32,33,34,35,36,37,38,39,40]::smallint[]);`,
      [otherTeamId],
    );

    // Saving again (e.g. the admin changes their mind before locking)
    // updates the same row rather than erroring on the unique constraint.
    await db.query(
      `insert into public.nrs_team_cluster_scenarios (team_id, cluster_key, question_ids)
       values ($1, 'Belonging', array[41,42,43,44,45,46,47,48,49,50]::smallint[])
       on conflict (team_id, cluster_key) do update set question_ids = excluded.question_ids;`,
      [otherTeamId],
    );

    const r = await db.query(`select question_ids from public.nrs_team_cluster_scenarios where team_id = $1;`, [
      otherTeamId,
    ]);
    expect((r.rows[0] as { question_ids: number[] }).question_ids).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  });
});
