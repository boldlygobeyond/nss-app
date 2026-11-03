// Verifies 0028's backfill against real Postgres (pglite): completed_at
// gets set to the max(answered_at) across a submission's own responses,
// only for submissions that are actually completed/report_generated, and
// is left null for anything still in progress or with no responses at all.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;

async function insertSubmission(status: string): Promise<string> {
  const id = randomUUID();
  await db.query("insert into public.nss_submissions (id, user_id, status) values ($1, $2, $3);", [
    id,
    randomUUID(),
    status,
  ]);
  return id;
}

async function insertResponse(submissionId: string, answeredAt: string) {
  await db.query("insert into public.nss_responses (submission_id, answered_at) values ($1, $2);", [
    submissionId,
    answeredAt,
  ]);
}

async function completedAtOf(submissionId: string): Promise<string | null> {
  const r = await db.query("select completed_at from public.nss_submissions where id = $1;", [submissionId]);
  // pglite returns timestamptz columns as Date objects, not strings.
  const value = (r.rows[0] as { completed_at: Date | string | null }).completed_at;
  return value instanceof Date ? value.toISOString() : value;
}

beforeAll(async () => {
  db = new PGlite();

  await db.exec(`
    create table public.nss_submissions (
      id uuid primary key,
      user_id uuid not null,
      status text not null default 'in_progress'
    );

    create table public.nss_responses (
      submission_id uuid not null references public.nss_submissions(id),
      answered_at timestamptz not null
    );
  `);

  // Set up realistic pre-migration state, then run 0028 against it —
  // mirroring the real production situation (existing completed
  // submissions with response history already in place).
  const completed = await insertSubmission("completed");
  await insertResponse(completed, "2026-09-01T10:00:00Z");
  await insertResponse(completed, "2026-09-01T10:15:00Z"); // the actual completion moment
  await insertResponse(completed, "2026-09-01T09:00:00Z");

  const reportGenerated = await insertSubmission("report_generated");
  await insertResponse(reportGenerated, "2026-08-15T14:30:00Z");

  const inProgress = await insertSubmission("in_progress");
  await insertResponse(inProgress, "2026-10-01T08:00:00Z");

  const completedNoResponses = await insertSubmission("completed");
  // Deliberately no responses — an edge case that shouldn't crash the
  // backfill; completed_at should just stay null for this one.

  (globalThis as unknown as { __ids: Record<string, string> }).__ids = {
    completed,
    reportGenerated,
    inProgress,
    completedNoResponses,
  };

  const migrationSql = readFileSync(
    new URL("../../../../supabase/migrations/0028_nss_submissions_completed_at.sql", import.meta.url),
    "utf8",
  );
  await db.exec(migrationSql);
});

afterAll(async () => {
  await db.close();
});

describe("0028 nss_submissions.completed_at backfill — real Postgres execution via pglite", () => {
  it("sets completed_at to the max(answered_at) for a completed submission", async () => {
    const { completed } = (globalThis as unknown as { __ids: Record<string, string> }).__ids;
    expect(await completedAtOf(completed)).toBe("2026-09-01T10:15:00.000Z");
  });

  it("backfills report_generated submissions too, not just completed", async () => {
    const { reportGenerated } = (globalThis as unknown as { __ids: Record<string, string> }).__ids;
    expect(await completedAtOf(reportGenerated)).toBe("2026-08-15T14:30:00.000Z");
  });

  it("leaves completed_at null for a submission still in progress", async () => {
    const { inProgress } = (globalThis as unknown as { __ids: Record<string, string> }).__ids;
    expect(await completedAtOf(inProgress)).toBeNull();
  });

  it("leaves completed_at null (not an error) for a completed submission with no response rows", async () => {
    const { completedNoResponses } = (globalThis as unknown as { __ids: Record<string, string> }).__ids;
    expect(await completedAtOf(completedNoResponses)).toBeNull();
  });

  it("running the backfill again is a no-op — doesn't touch already-set values", async () => {
    const { completed } = (globalThis as unknown as { __ids: Record<string, string> }).__ids;
    await insertResponse(completed, "2026-12-25T00:00:00Z"); // a later response that shouldn't retroactively change anything
    const migrationSql = readFileSync(
      new URL("../../../../supabase/migrations/0028_nss_submissions_completed_at.sql", import.meta.url),
      "utf8",
    );
    // Only the backfill UPDATE is idempotent-safe to re-run (the ADD
    // COLUMN above it is not); isolate just that statement.
    const backfillStart = migrationSql.indexOf("update public.nss_submissions");
    await db.exec(migrationSql.slice(backfillStart));
    expect(await completedAtOf(completed)).toBe("2026-09-01T10:15:00.000Z");
  });
});
