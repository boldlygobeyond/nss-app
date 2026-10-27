// Tests computeSurveyIntegrity against a mocked Supabase client. Every
// builder method that would WRITE (insert/update/delete/upsert/rpc) throws
// if called at all — a structural guarantee, not just a code-review claim,
// that this diagnostic never modifies answers, scoring, or reports.
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSurveyIntegrity, MIGRATION_CUTOFF } from "../surveyIntegrity";

function makeClient(config: {
  submission?: { data: unknown; error?: unknown } | null;
  responses?: { data: unknown; error?: unknown };
  questions?: { data: unknown; error?: unknown };
}): SupabaseClient {
  const results: Record<string, { data: unknown; error: unknown }> = {
    nss_submissions: config.submission === null ? { data: null, error: null } : { data: null, error: null, ...config.submission },
    nss_responses: { data: [], error: null, ...config.responses },
    nss_questions: { data: [], error: null, ...config.questions },
  };

  const writeTrap = (name: string) => () => {
    throw new Error(`computeSurveyIntegrity must never call .${name}() — it is read-only`);
  };

  const from = (table: string) => {
    const result = results[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ["select", "eq", "order", "in"]) builder[m] = vi.fn(chain);
    for (const m of ["insert", "update", "delete", "upsert"]) builder[m] = vi.fn(writeTrap(m));
    builder.maybeSingle = vi.fn(async () => result);
    builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return builder;
  };

  return { from, rpc: vi.fn(writeTrap("rpc")) } as unknown as SupabaseClient;
}

const CLUSTERS = ["Agency", "Belonging", "Stability", "Ecosystem", "Connections", "Purpose", "Recognition"] as const;

function allPairs(): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < CLUSTERS.length; i++) {
    for (let j = i + 1; j < CLUSTERS.length; j++) pairs.push([CLUSTERS[i], CLUSTERS[j]]);
  }
  return pairs;
}

function calibrationQuestionRows(ids: number[]) {
  const pairs = allPairs();
  return ids.map((id, i) => ({ id, cluster_a: pairs[i % 21][0], cluster_b: pairs[i % 21][1] }));
}

describe("computeSurveyIntegrity", () => {
  it("1. clean completed submission: everything passes", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const responses = ids.map((id, i) => ({ question_id: id, answered_at: `2026-10-21T00:00:${String(i).padStart(2, "0")}.000Z` }));
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: ids, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: responses },
      questions: { data: calibrationQuestionRows(ids.slice(0, 21)) },
    });
    const result = await computeSurveyIntegrity(client, "sub-1");
    expect(result?.overallStatus).toBe("passed");
    expect(result?.decisiveAnswers).toMatchObject({ status: "pass", count: 50, expected: 50, mismatch: false });
    expect(result?.duplicates).toMatchObject({ status: "pass", groups: [] });
    expect(result?.calibration).toMatchObject({ status: "pass", covered: 21, missingPairs: [] });
    expect(result?.scoring.status).toBe("pass");
  });

  it("2. in-progress submission: incomplete overall, but calibration can still pass if already finished", async () => {
    const calibrationIds = Array.from({ length: 21 }, (_, i) => i + 1);
    const sequence = [...calibrationIds, 101, 102, 103]; // calibration done, a few adaptive questions in
    const responses = sequence
      .slice(0, 24)
      .map((id, i) => ({ question_id: id, answered_at: `2026-10-21T00:00:${String(i).padStart(2, "0")}.000Z` }));
    const client = makeClient({
      submission: { data: { status: "in_progress", questions_answered: 24, question_sequence: sequence, top_needs: null } },
      responses: { data: responses },
      questions: { data: calibrationQuestionRows(calibrationIds) },
    });
    const result = await computeSurveyIntegrity(client, "sub-2");
    expect(result?.overallStatus).toBe("incomplete");
    expect(result?.decisiveAnswers).toMatchObject({ status: "incomplete", count: 24, expected: null });
    expect(result?.calibration.status).toBe("pass"); // calibration itself is done even though the survey isn't
    expect(result?.scoring.status).toBe("incomplete");
  });

  it("3. historical duplicate records (both rows predate the migration cutoff)", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const responses = [
      ...ids.map((id, i) => ({ question_id: id, answered_at: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z` })),
      { question_id: 5, answered_at: "2026-09-01T00:00:14.000Z" }, // a second, earlier/historical row for q5
    ];
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: ids, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: responses },
      questions: { data: calibrationQuestionRows(ids.slice(0, 21)) },
    });
    const result = await computeSurveyIntegrity(client, "sub-3");
    expect(result?.duplicates.status).toBe("issue");
    expect(result?.duplicates.historicalCount).toBe(1);
    expect(result?.duplicates.newCount).toBe(0);
    expect(result?.duplicates.groups[0]).toMatchObject({ questionId: 5, rowCount: 2, isHistorical: true });
  });

  it("4. post-migration duplicate records (at least one row at/after the cutoff) are distinguished from historical ones", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const responses = [
      ...ids.map((id, i) => ({ question_id: id, answered_at: `2026-10-21T00:00:${String(i).padStart(2, "0")}.000Z` })),
      { question_id: 5, answered_at: MIGRATION_CUTOFF }, // a duplicate AT the cutoff instant -- counts as "new"
    ];
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: ids, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: responses },
      questions: { data: calibrationQuestionRows(ids.slice(0, 21)) },
    });
    const result = await computeSurveyIntegrity(client, "sub-4");
    expect(result?.duplicates.status).toBe("issue");
    expect(result?.duplicates.newCount).toBe(1);
    expect(result?.duplicates.groups[0]).toMatchObject({ questionId: 5, isHistorical: false });
  });

  it("5a. missing calibration evidence: sequence shorter than 21 on a COMPLETED submission is an issue, not just incomplete", async () => {
    const shortSequence = Array.from({ length: 10 }, (_, i) => i + 1);
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: shortSequence, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: shortSequence.map((id) => ({ question_id: id, answered_at: "2026-10-21T00:00:00.000Z" })) },
    });
    const result = await computeSurveyIntegrity(client, "sub-5a");
    expect(result?.calibration.status).toBe("issue");
    expect(result?.calibration.note).toMatch(/fewer than 21/);
  });

  it("5b. incomplete calibration evidence: delivered question ids no longer resolve in the question bank -> unable to verify", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: ids, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: ids.map((id) => ({ question_id: id, answered_at: "2026-10-21T00:00:00.000Z" })) },
      questions: { data: [] }, // none of the 21 calibration ids resolve
    });
    const result = await computeSurveyIntegrity(client, "sub-5b");
    expect(result?.calibration.status).toBe("unable_to_verify");
  });

  it("6. scoring-input mismatch: stored questions_answered disagrees with the actual decisive count -> scoring unable to verify", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const client = makeClient({
      // stored count says 50, but only 49 distinct decisive rows actually exist
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: ids, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: ids.slice(0, 49).map((id) => ({ question_id: id, answered_at: "2026-10-21T00:00:00.000Z" })) },
      questions: { data: calibrationQuestionRows(ids.slice(0, 21)) },
    });
    const result = await computeSurveyIntegrity(client, "sub-6");
    expect(result?.decisiveAnswers).toMatchObject({ status: "issue", mismatch: true, count: 49, storedQuestionsAnswered: 50 });
    expect(result?.scoring.status).toBe("unable_to_verify");
    expect(result?.overallStatus).toBe("issues_detected");
  });

  it("7. unauthorized access: RLS-filtered (empty) submission row -> returns null, not an error or someone else's data", async () => {
    const client = makeClient({ submission: { data: null, error: null } });
    const result = await computeSurveyIntegrity(client, "someone-elses-submission");
    expect(result).toBeNull();
  });

  it("8. unavailable/malformed diagnostic data: a query error returns null rather than throwing or guessing", async () => {
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: [1], top_needs: null } },
      responses: { data: null, error: { message: "connection reset" } },
    });
    const result = await computeSurveyIntegrity(client, "sub-8");
    expect(result).toBeNull();
  });

  it("never issues a write call of any kind (insert/update/delete/upsert/rpc)", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const client = makeClient({
      submission: { data: { status: "completed", questions_answered: 50, question_sequence: ids, top_needs: [{ cluster: "Agency" }] } },
      responses: { data: ids.map((id) => ({ question_id: id, answered_at: "2026-10-21T00:00:00.000Z" })) },
      questions: { data: calibrationQuestionRows(ids.slice(0, 21)) },
    });
    // The mock itself throws if any write method is ever called -- reaching
    // this assertion without throwing already proves it, this just makes
    // the intent explicit.
    await expect(computeSurveyIntegrity(client, "sub-write-check")).resolves.not.toBeNull();
  });
});
