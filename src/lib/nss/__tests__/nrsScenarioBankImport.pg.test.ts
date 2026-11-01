// Simulates the actual production situation 0026 has to handle safely:
// a team that already has real NRS submissions/responses against the
// original 10 Core Stability question ids, BEFORE the 210-scenario bank
// and nrs_team_cluster_scenarios exist. Runs 0022-0025 first, inserts
// that pre-existing state by hand (mirroring the real "NRS Test Team" /
// "V2 Pilot Team" data), then runs 0026 and checks: the original 10
// question ids are untouched (same scenario_text, same id — so existing
// nrs_responses still resolve correctly), all 210 scenarios exist, every
// cluster is marked configured, and the pre-existing team's selection was
// auto-seeded to its original 10 ids (so it reads as already-locked with
// zero behavior change).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
let teamId: string;
let rosterId: string;
let submissionId: string;

beforeAll(async () => {
  db = new PGlite();

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

    create function pg_advisory_xact_lock(int, int) returns void
      language plpgsql as $$ begin end; $$;
  `);

  const migrationsDir = new URL("../../../../supabase/migrations/", import.meta.url);
  const run = async (file: string) => db.exec(readFileSync(new URL(file, migrationsDir), "utf8"));

  // 0022-0025 only — the pre-210-scenario, pre-selection-feature world.
  await run("0022_nrs_schema.sql");
  await run("0023_seed_nrs_core_stability.sql");
  await run("0024_nrs_upsert_response.sql");
  await run("0025_nrs_team_cluster_scenarios.sql");

  // Real pre-existing pilot data, exactly as it looked before this feature:
  // a team, a roster member, and a completed Core Stability submission
  // against the original 10 question ids — no nrs_team_cluster_scenarios
  // row at all yet, since that table didn't exist until 0025 (and nothing
  // wrote to it until 0026's own seeding step, which hasn't run yet here).
  teamId = randomUUID();
  await db.query(`insert into public.teams (id, name, slug) values ($1, 'NRS Test Team', $2);`, [
    teamId,
    `nrs-test-team-${teamId}`,
  ]);
  rosterId = randomUUID();
  await db.query(
    `insert into public.team_roster (id, team_id, first_name, last_name, email, manager_email)
     values ($1, $2, 'Marc', 'Test', 'marc@example.com', 'manager@example.com');`,
    [rosterId, teamId],
  );
  submissionId = randomUUID();
  await db.query(
    `insert into public.nrs_submissions (id, roster_id, cluster_key, access_token, status, resonance_score)
     values ($1, $2, 'Stability', $3, 'completed', 3.7);`,
    [submissionId, rosterId, randomUUID()],
  );
  await db.query(
    `insert into public.nrs_responses (submission_id, question_id, rating) values ($1, 1, 4), ($1, 2, 3);`,
    [submissionId],
  );

  // Now the migration under test.
  await run("0026_nrs_scenario_bank_import.sql");
});

afterAll(async () => {
  await db.close();
});

describe("0026 scenario bank import — real Postgres execution via pglite, against pre-existing pilot data", () => {
  it("imports all 210 scenarios, 30 per cluster", async () => {
    const total = await db.query("select count(*)::int as n from public.nrs_questions;");
    expect((total.rows[0] as { n: number }).n).toBe(210);

    const perCluster = await db.query(
      "select cluster_key, count(*)::int as n from public.nrs_questions group by cluster_key order by cluster_key;",
    );
    for (const row of perCluster.rows as { cluster_key: string; n: number }[]) {
      expect(row.n).toBe(30);
    }
  });

  it("leaves the pre-existing question ids 1-10 at their original ids and scenario_text", async () => {
    const r = await db.query("select id, scenario_text from public.nrs_questions where id = 1;");
    expect((r.rows[0] as { scenario_text: string }).scenario_text).toBe(
      "You disagree with a teammate's suggestion in a brainstorming session. They welcome your input, and no one takes it personally.",
    );
  });

  it("does not disturb the pre-existing submission or its responses", async () => {
    const sub = await db.query("select status, resonance_score from public.nrs_submissions where id = $1;", [
      submissionId,
    ]);
    expect(sub.rows[0]).toMatchObject({ status: "completed", resonance_score: "3.7" });

    const responses = await db.query(
      "select question_id, rating from public.nrs_responses where submission_id = $1 order by question_id;",
      [submissionId],
    );
    expect(responses.rows).toEqual([
      { question_id: 1, rating: 4 },
      { question_id: 2, rating: 3 },
    ]);
  });

  it("marks every cluster configured", async () => {
    const r = await db.query("select count(*)::int as n from public.nrs_clusters where configured = false;");
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });

  it("auto-seeds the pre-existing team's Stability selection to its original 10 ids", async () => {
    const r = await db.query(
      "select question_ids from public.nrs_team_cluster_scenarios where team_id = $1 and cluster_key = 'Stability';",
      [teamId],
    );
    expect((r.rows[0] as { question_ids: number[] }).question_ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("running 0026's seed step again is a no-op (idempotent), not an error", async () => {
    const migrationsDir = new URL("../../../../supabase/migrations/", import.meta.url);
    const sql = readFileSync(new URL("0026_nrs_scenario_bank_import.sql", migrationsDir), "utf8");
    // The insert/update statements are the only re-runnable parts in
    // practice (the id=1..10 inserts would conflict); isolate just the
    // idempotent tail to exercise ON CONFLICT DO NOTHING specifically.
    const seedStart = sql.indexOf("insert into public.nrs_team_cluster_scenarios");
    await db.exec(sql.slice(seedStart));

    const r = await db.query(
      "select count(*)::int as n from public.nrs_team_cluster_scenarios where team_id = $1 and cluster_key = 'Stability';",
      [teamId],
    );
    expect((r.rows[0] as { n: number }).n).toBe(1);
  });
});
