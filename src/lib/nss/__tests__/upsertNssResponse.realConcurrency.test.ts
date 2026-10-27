// Closes the one gap upsertNssResponse.pg.test.ts (pglite) explicitly
// could not: genuine concurrent-transaction behavior. pglite is a
// single-connection embedded engine, so there was no second, independent
// session to race against, and pg_advisory_xact_lock doesn't even exist
// there for that reason — it had to be stubbed out as a no-op to run the
// rest of the migration at all.
//
// This file uses `embedded-postgres` instead: a real, temporary,
// multi-connection PostgreSQL server (an actual compiled Postgres binary,
// not a reimplementation or a WASM single-connection engine), started
// fresh for this test run and torn down afterward. It runs entirely
// locally — no Docker, no staging project, no production access of any
// kind — and genuinely supports two separate TCP connections with two
// independently open transactions, which is what proving the advisory
// lock's real blocking behavior requires. No compatibility shims are
// needed here: pg_advisory_xact_lock is the real function.
//
// See NSS_Back_Navigation_And_Duplicate_Fix.md §3 for how this fits
// alongside the pglite suite and what each one proves.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";

let pgServer: EmbeddedPostgres;
let dataDir: string;
let adminClient: Client;

async function newClient(): Promise<Client> {
  const client = pgServer.getPgClient();
  await client.connect();
  return client;
}

async function setCurrentUser(client: Client, userId: string) {
  await client.query("select set_config('nss_test.current_user_id', $1, false);", [userId]);
}

async function createSubmission(userId: string): Promise<string> {
  const id = randomUUID();
  await adminClient.query("insert into public.nss_submissions (id, user_id) values ($1, $2);", [id, userId]);
  return id;
}

function callUpsert(
  client: Client,
  params: {
    submissionId: string;
    questionId: number;
    selection: "A" | "B";
    chosenClusters: string[];
    rejectedClusters: string[];
    answeredAt: string;
  },
) {
  return client.query(`select public.upsert_nss_response($1, $2, $3, $4, $5, $6, $7, $8);`, [
    params.submissionId,
    params.questionId,
    null,
    false,
    params.selection,
    params.chosenClusters,
    params.rejectedClusters,
    params.answeredAt,
  ]);
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "nss-pg-realconc-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: 57432,
    persistent: false,
  });
  await pgServer.initialise();
  await pgServer.start();
  adminClient = await newClient();

  await adminClient.query(`
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
  `);

  // The real, unmodified migration file — no compatibility shims needed
  // this time, since pg_advisory_xact_lock is the genuine function.
  const migrationSql = readFileSync(
    new URL("../../../../supabase/migrations/0021_nss_responses_unique_per_question.sql", import.meta.url),
    "utf8",
  );
  await adminClient.query(migrationSql);
}, 60_000);

afterAll(async () => {
  await adminClient?.end();
  await pgServer?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("upsert_nss_response — genuine concurrent connections, real Postgres, real advisory lock", () => {
  it(
    "two concurrent first-time writes for the same question: the second genuinely blocks until the first commits, exactly one row survives",
    async () => {
      const userId = randomUUID();
      const submissionId = await createSubmission(userId);

      const conn1 = await newClient();
      const conn2 = await newClient();
      await setCurrentUser(conn1, userId);
      await setCurrentUser(conn2, userId);

      await conn1.query("begin;");
      await callUpsert(conn1, {
        submissionId,
        questionId: 1,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      });
      // conn1's transaction is open, holding the advisory lock, uncommitted.

      let conn2Settled = false;
      const conn2Promise = callUpsert(conn2, {
        submissionId,
        questionId: 1,
        selection: "B",
        chosenClusters: ["Connections"],
        rejectedClusters: ["Recognition"],
        answeredAt: new Date().toISOString(),
      }).then(() => {
        conn2Settled = true;
      });

      // Give conn2 a real window to have returned if it weren't actually
      // blocked — this is the crux of the whole test.
      await new Promise((r) => setTimeout(r, 500));
      expect(conn2Settled).toBe(false);

      await conn1.query("commit;");
      await conn2Promise;
      expect(conn2Settled).toBe(true);

      const { rows } = await adminClient.query(
        "select question_id, selection from public.nss_responses where submission_id = $1;",
        [submissionId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ question_id: 1, selection: "B" }); // conn2 committed after conn1

      await conn1.end();
      await conn2.end();
    },
    15_000,
  );

  it(
    "two concurrent corrections to an already-existing answer: the second genuinely blocks until the first commits, exactly one row survives",
    async () => {
      const userId = randomUUID();
      const submissionId = await createSubmission(userId);
      const seed = await newClient();
      await setCurrentUser(seed, userId);
      await callUpsert(seed, {
        submissionId,
        questionId: 2,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date(Date.now() - 10_000).toISOString(),
      });
      await seed.end();

      const conn1 = await newClient();
      const conn2 = await newClient();
      await setCurrentUser(conn1, userId);
      await setCurrentUser(conn2, userId);

      await conn1.query("begin;");
      await callUpsert(conn1, {
        submissionId,
        questionId: 2,
        selection: "B",
        chosenClusters: ["Connections"],
        rejectedClusters: ["Recognition"],
        answeredAt: new Date().toISOString(),
      });

      let conn2Settled = false;
      const conn2Promise = callUpsert(conn2, {
        submissionId,
        questionId: 2,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date(Date.now() + 1000).toISOString(),
      }).then(() => {
        conn2Settled = true;
      });

      await new Promise((r) => setTimeout(r, 500));
      expect(conn2Settled).toBe(false);

      await conn1.query("commit;");
      await conn2Promise;
      expect(conn2Settled).toBe(true);

      const { rows } = await adminClient.query(
        "select question_id, selection from public.nss_responses where submission_id = $1;",
        [submissionId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ question_id: 2, selection: "A" });

      await conn1.end();
      await conn2.end();
    },
    15_000,
  );

  it(
    "concurrent writes to DIFFERENT questions are not blocked by each other (the lock is scoped per question, not global)",
    async () => {
      const userId = randomUUID();
      const submissionId = await createSubmission(userId);

      const conn1 = await newClient();
      const conn2 = await newClient();
      await setCurrentUser(conn1, userId);
      await setCurrentUser(conn2, userId);

      await conn1.query("begin;");
      await callUpsert(conn1, {
        submissionId,
        questionId: 3,
        selection: "A",
        chosenClusters: ["Recognition"],
        rejectedClusters: ["Connections"],
        answeredAt: new Date().toISOString(),
      });
      // conn1 holds the lock for question 3, uncommitted.

      // A different question (4) must NOT be blocked by that.
      await expect(
        callUpsert(conn2, {
          submissionId,
          questionId: 4,
          selection: "B",
          chosenClusters: ["Stability"],
          rejectedClusters: ["Purpose"],
          answeredAt: new Date().toISOString(),
        }),
      ).resolves.toBeDefined();

      await conn1.query("commit;");
      const { rows } = await adminClient.query(
        "select question_id from public.nss_responses where submission_id = $1 order by question_id;",
        [submissionId],
      );
      expect(rows.map((r: { question_id: number }) => r.question_id)).toEqual([3, 4]);

      await conn1.end();
      await conn2.end();
    },
    15_000,
  );
});
