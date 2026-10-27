// Answers the question "can a respondent mid-survey during deployment
// continue without losing answers?" directly, rather than by argument —
// using the REAL application code (api.ts's upsertResponse and
// listResponsesForSubmission, not reimplementations) against a real,
// temporary, local PostgreSQL server (embedded-postgres), simulating the
// actual sequence a real deployment produces for someone already mid-survey:
//
//   1. Old app code writes a few answers (plain delete-then-insert, no
//      RPC — this mirrors the CURRENTLY DEPLOYED api.ts's insertResponse/
//      deleteResponseForQuestion, read directly from git HEAD, not
//      guessed).
//   2. The migration is applied to the live database — the respondent's
//      tab is still open, still running old code.
//   3. Old code keeps writing (the respondent hasn't reloaded) — this is
//      the "migration landed, app not deployed yet" window.
//   4. New app code is deployed — the respondent STILL hasn't reloaded,
//      so their tab is still running old code against a database that
//      now has both the migration AND would-be-new-app-compatible schema.
//   5. Old code writes once more in this window, before any reload.
//   6. The respondent reloads: new code resumes the session by calling
//      the REAL listResponsesForSubmission against everything old code
//      wrote, across every phase above.
//   7. New code then issues a real correction (upsertResponse) to a row
//      old code originally wrote, and a fresh answer.
//   8. Final state is checked directly against the database: every
//      question answered across every phase is present exactly once, the
//      correction replaced rather than duplicated, nothing was lost.
//
// No staging project, no browser, no production access — see
// NSS_Back_Navigation_And_Duplicate_Fix.md and
// NSS_Staging_Verification_Checklist.md §C for why this specific scenario
// mattered and how this differs from (and locally substitutes for) a
// staging/browser-driven version of the same check.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertResponse, listResponsesForSubmission } from "../api";

let pgServer: EmbeddedPostgres;
let dataDir: string;
let db: Client;
let userId: string;
let submissionId: string;

/** A minimal, test-only stand-in for SupabaseClient backed directly by the real pg connection — enough for upsertResponse/listResponsesForSubmission's actual code (not a reimplementation of it) to run against real Postgres without needing PostgREST/Supabase Auth running locally. */
function makeAdapter(client: Client): SupabaseClient {
  const adapter = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        await client.query(`select public.${name}($1,$2,$3,$4,$5,$6,$7,$8);`, [
          args.p_submission_id,
          args.p_question_id,
          args.p_original_question_id,
          args.p_is_sharpened,
          args.p_selection,
          args.p_chosen_clusters,
          args.p_rejected_clusters,
          args.p_answered_at,
        ]);
        return { data: null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => ({
          order: async () => {
            const { rows } = await client.query(
              `select question_id, original_question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at
               from public.${table} where ${col} = $1 order by answered_at asc;`,
              [val],
            );
            // The real Supabase REST API always returns timestamptz as an
            // ISO string over JSON; node-postgres's own default type
            // parsing turns it into a JS Date instead, which the app code
            // (responseDedup.ts's latestResponsePerQuestion) doesn't
            // expect — matching what the real client actually hands this
            // code, not a pg-specific representation.
            const data = rows.map((r: { answered_at: Date }) => ({ ...r, answered_at: r.answered_at.toISOString() }));
            return { data, error: null };
          },
        }),
      }),
    }),
  };
  return adapter as unknown as SupabaseClient;
}

/** Mirrors the CURRENTLY DEPLOYED (pre-this-fix) client write pattern exactly — a plain client-driven delete-then-insert, no RPC, no stale-write protection — read directly from `git show HEAD:src/lib/nss/api.ts`'s insertResponse/deleteResponseForQuestion, not guessed. */
async function oldCodeWrite(
  client: Client,
  params: { questionId: number; isSharpened: boolean; selection: "A" | "B"; chosenClusters: string[]; rejectedClusters: string[] },
) {
  await client.query("delete from public.nss_responses where submission_id = $1 and question_id = $2;", [
    submissionId,
    params.questionId,
  ]);
  await client.query(
    `insert into public.nss_responses (submission_id, question_id, original_question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at)
     values ($1, $2, null, $3, $4, $5, $6, now());`,
    [submissionId, params.questionId, params.isSharpened, params.selection, params.chosenClusters, params.rejectedClusters],
  );
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "nss-pg-transition-"));
  pgServer = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port: 57433, persistent: false });
  await pgServer.initialise();
  await pgServer.start();
  db = pgServer.getPgClient();
  await db.connect();

  // Schema as it exists BEFORE migration 0021 — deliberately not applying
  // it yet, since this test's whole point is to apply it partway through.
  await db.query(`
    create role authenticated;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('nss_test.current_user_id', true), '')::uuid;
    $$;
    create table public.nss_submissions (id uuid primary key, user_id uuid not null);
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

  userId = randomUUID();
  submissionId = randomUUID();
  await db.query("insert into public.nss_submissions (id, user_id) values ($1, $2);", [submissionId, userId]);
  await db.query("select set_config('nss_test.current_user_id', $1, false);", [userId]);
}, 60_000);

afterAll(async () => {
  await db?.end();
  await pgServer?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("deployment transition: a respondent mid-survey when migration + app deploy happen underneath them", () => {
  it("every answer survives the transition; a post-reload correction replaces rather than duplicates; nothing is lost", async () => {
    // Phase 1 — old app, pre-migration: three ordinary answers.
    await oldCodeWrite(db, { questionId: 1, isSharpened: false, selection: "A", chosenClusters: ["Recognition"], rejectedClusters: ["Connections"] });
    await oldCodeWrite(db, { questionId: 2, isSharpened: false, selection: "A", chosenClusters: ["Agency"], rejectedClusters: ["Stability"] });
    await oldCodeWrite(db, { questionId: 3, isSharpened: true, selection: "B", chosenClusters: ["Purpose"], rejectedClusters: ["Ecosystem"] });

    // Phase 2 — migration lands; the respondent's tab is still open, still old code.
    const migrationSql = readFileSync(
      new URL("../../../../supabase/migrations/0021_nss_responses_unique_per_question.sql", import.meta.url),
      "utf8",
    );
    await db.query(migrationSql);

    // Phase 3 — still old code, migration now live: must keep working with no error.
    await expect(
      oldCodeWrite(db, { questionId: 4, isSharpened: false, selection: "A", chosenClusters: ["Belonging"], rejectedClusters: ["Recognition"] }),
    ).resolves.toBeUndefined();

    // Phase 4 — new app code is now deployed too, but the tab STILL hasn't
    // reloaded, so it's still running old code. Must still keep working.
    await expect(
      oldCodeWrite(db, { questionId: 5, isSharpened: false, selection: "B", chosenClusters: ["Stability"], rejectedClusters: ["Agency"] }),
    ).resolves.toBeUndefined();

    // Phase 5 — the respondent reloads. New code resumes via the REAL
    // listResponsesForSubmission against everything old code wrote across
    // every phase above.
    const adapter = makeAdapter(db);
    const resumed = await listResponsesForSubmission(adapter, submissionId);
    expect(resumed.map((r) => r.question_id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(resumed.find((r) => r.question_id === 3)).toMatchObject({ is_sharpened: true, selection: "B" });

    // Phase 6 — new code issues a real correction (via the real RPC path)
    // to a row OLD code originally wrote, across the migration boundary.
    await upsertResponse(adapter, {
      submissionId,
      questionId: 2,
      isSharpened: false,
      selection: "B",
      chosenClusters: ["Stability"],
      rejectedClusters: ["Agency"],
      answeredAt: new Date().toISOString(),
    });

    // Phase 7 — new code answers a genuinely fresh question.
    await upsertResponse(adapter, {
      submissionId,
      questionId: 6,
      isSharpened: false,
      selection: "A",
      chosenClusters: ["Connections"],
      rejectedClusters: ["Purpose"],
      answeredAt: new Date().toISOString(),
    });

    // Final state: every question from every phase present exactly once;
    // the correction replaced (not duplicated) question 2.
    const { rows } = await db.query(
      "select question_id, selection from public.nss_responses where submission_id = $1 order by question_id;",
      [submissionId],
    );
    expect(rows).toEqual([
      { question_id: 1, selection: "A" },
      { question_id: 2, selection: "B" }, // corrected, not duplicated
      { question_id: 3, selection: "B" },
      { question_id: 4, selection: "A" },
      { question_id: 5, selection: "B" },
      { question_id: 6, selection: "A" },
    ]);
  }, 20_000);
});
