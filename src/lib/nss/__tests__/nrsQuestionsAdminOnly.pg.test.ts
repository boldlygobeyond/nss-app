// Verifies migration 0029 (nrs_questions_admin_only) on a real embedded
// Postgres engine, with row level security actually enforced — unlike
// upsertNrsResponse.pg.test.ts's harness (which hardcodes is_admin() to
// false and never switches off the superuser connection, since it only
// needs to exercise a SECURITY DEFINER function's own internal checks),
// this test needs a *real*, parameterizable is_admin() and an actual
// non-owner `authenticated` role connection, since what's being verified
// is RLS itself — a SELECT a non-admin isn't allowed to see doesn't
// error, it just silently returns zero rows, which is exactly the
// failure mode a stubbed-out or superuser-bypassed test would never
// catch.
//
// Explicitly NOT applied to any real database by this test or by running
// it — it only runs the migration SQL inside a disposable in-memory
// Postgres instance.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
let adminId: string;
let plainUserId: string;

async function asUser(userId: string | null) {
  // Mirrors how Supabase's PostgREST actually authenticates a request:
  // connect as the `authenticated` role (not the table owner, so RLS is
  // genuinely enforced) with auth.uid() resolving to that session's user.
  await db.query(`select set_config('test.current_user_id', $1, false);`, [userId ?? ""]);
  await db.exec(`set role authenticated;`);
}

async function asSuperuser() {
  await db.exec(`reset role;`);
}

beforeAll(async () => {
  db = new PGlite();

  await db.exec(`
    create role authenticated;
    create role anon;
    -- Mirrors Supabase's own default-privilege posture for a fresh
    -- project: authenticated/anon get broad table grants, with RLS (not
    -- the grant system) as the real access gate — the same baseline every
    -- migration in this repo is written against, since none of them
    -- issue their own GRANT statements.
    grant usage on schema public to authenticated, anon;

    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    -- Settable per-query, unlike upsertNrsResponse.pg.test.ts's hardcoded
    -- null — this is the one thing this test actually needs to vary.
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.current_user_id', true), '')::uuid;
    $$;

    create table public.user_profiles (
      id uuid primary key,
      role text not null default 'user'
    );

    -- The REAL definition from 0001_init_schema.sql, not a hardcoded
    -- stub — the whole point of this test is to verify this function's
    -- actual behavior against the nrs_questions policy.
    create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.user_profiles
        where id = auth.uid() and role = 'admin'
      );
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
  for (const file of [
    "0022_nrs_schema.sql",
    "0023_seed_nrs_core_stability.sql",
    "0024_nrs_upsert_response.sql",
    "0025_nrs_team_cluster_scenarios.sql",
    "0026_nrs_scenario_bank_import.sql",
    "0027_nrs_upsert_response_scoped_to_selection.sql",
    "0029_nrs_questions_admin_only.sql",
  ]) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    await db.exec(sql);
  }

  // authenticated/anon need real grants on the tables this test queries —
  // same baseline as the `grant usage on schema public` above.
  await db.exec(`grant select on public.nrs_questions, public.user_profiles to authenticated, anon;`);

  adminId = randomUUID();
  plainUserId = randomUUID();
  await db.query(`insert into public.user_profiles (id, role) values ($1, 'admin');`, [adminId]);
  await db.query(`insert into public.user_profiles (id, role) values ($1, 'user');`, [plainUserId]);
});

afterAll(async () => {
  await db.close();
});

describe("migration 0029: nrs_questions admin-only RLS", () => {
  it("lets an admin read nrs_questions, including need_label", async () => {
    await asUser(adminId);
    const r = await db.query(`select id, need_label from public.nrs_questions order by id limit 1;`);
    await asSuperuser();
    expect(r.rows.length).toBe(1);
    expect((r.rows[0] as { need_label: string }).need_label).toBeTruthy();
  });

  it("blocks an ordinary authenticated (non-admin) user from reading nrs_questions at all", async () => {
    await asUser(plainUserId);
    const r = await db.query(`select id, need_label from public.nrs_questions;`);
    await asSuperuser();
    // RLS denial on SELECT is silent — zero rows, not an error. A test
    // that only checked "no exception thrown" would miss this entirely.
    expect(r.rows.length).toBe(0);
  });

  it("blocks an anonymous (no session) caller the same way", async () => {
    await db.exec(`set role anon;`);
    const r = await db.query(`select id from public.nrs_questions;`);
    await asSuperuser();
    expect(r.rows.length).toBe(0);
  });

  it("still lets the service-role path work (RLS doesn't apply to it at all)", async () => {
    // The actual participant route (src/app/api/nrs/[token]/route.ts)
    // reads this table through createAdminClient() — the Postgres
    // service_role, which bypasses RLS entirely regardless of this
    // policy. Modeled here as the table-owner connection, which is what
    // this whole file runs as outside of asUser()/set role.
    const r = await db.query(`select id, display_order, scenario_text from public.nrs_questions order by id;`);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
