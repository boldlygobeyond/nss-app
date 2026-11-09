import { describe, expect, it } from "vitest";
import {
  toRowResult,
  summarizeResults,
  describeBulkSummary,
  latestInviteStatusBySubmission,
  latestInviteLogBySubmission,
  type SendLogRow,
} from "../sendOutcome";

describe("toRowResult", () => {
  it("treats outcome: sent as sent", () => {
    expect(toRowResult({ outcome: "sent" })).toEqual({ kind: "sent" });
  });

  it("treats outcome: mocked as mocked, never as a plain success", () => {
    expect(toRowResult({ outcome: "mocked" })).toEqual({ kind: "mocked" });
  });

  it("treats outcome: failed as failed and keeps the error message", () => {
    expect(toRowResult({ outcome: "failed", error: "Resend 500" })).toEqual({
      kind: "failed",
      message: "Resend 500",
    });
  });

  it("treats a skipped item as skipped and keeps the reason, not failed", () => {
    expect(toRowResult({ skipped: true, reason: "Already completed, or reminded within the last minute" })).toEqual({
      kind: "skipped",
      message: "Already completed, or reminded within the last minute",
    });
  });

  it("treats a missing item as failed rather than defaulting to sent", () => {
    expect(toRowResult(undefined)).toEqual({ kind: "failed", message: "No response from the server" });
    expect(toRowResult(null)).toEqual({ kind: "failed", message: "No response from the server" });
  });

  it("treats an item with no recognizable outcome as failed, not sent", () => {
    expect(toRowResult({})).toEqual({ kind: "failed", message: undefined });
  });
});

describe("summarizeResults", () => {
  it("counts an all-sent batch correctly", () => {
    const summary = summarizeResults([{ outcome: "sent" }, { outcome: "sent" }, { outcome: "sent" }]);
    expect(summary).toEqual({ sent: 3, mocked: 0, skipped: 0, failed: 0, failedMessages: [] });
  });

  it("counts a genuinely mixed partial-failure batch correctly", () => {
    const summary = summarizeResults([
      { outcome: "sent" },
      { outcome: "failed", error: "Resend 500" },
      { outcome: "mocked" },
      { skipped: true, reason: "Already completed, or reminded within the last minute" },
      { outcome: "failed", error: "Invalid recipient" },
    ]);
    expect(summary).toEqual({
      sent: 1,
      mocked: 1,
      skipped: 1,
      failed: 2,
      failedMessages: ["Resend 500", "Invalid recipient"],
    });
  });

  it("counts an all-failed batch as zero sent, not a partial success", () => {
    const summary = summarizeResults([
      { outcome: "failed", error: "Resend down" },
      { outcome: "failed", error: "Resend down" },
    ]);
    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(2);
  });

  it("treats missing entries (e.g. a roster id the server couldn't find) as failures", () => {
    const summary = summarizeResults([{ outcome: "sent" }, undefined, null]);
    expect(summary).toEqual({ sent: 1, mocked: 0, skipped: 0, failed: 2, failedMessages: expect.any(Array) });
  });
});

describe("describeBulkSummary", () => {
  it("returns null when every recipient was genuinely sent live", () => {
    const summary = summarizeResults([{ outcome: "sent" }, { outcome: "sent" }]);
    expect(describeBulkSummary(summary, "invitation")).toBeNull();
  });

  it("never stays silent about a fully-mocked batch, even with zero failures", () => {
    const summary = summarizeResults([{ outcome: "mocked" }, { outcome: "mocked" }]);
    const message = describeBulkSummary(summary, "invitation");
    expect(message).not.toBeNull();
    expect(message).toContain("2 mocked");
  });

  it("reports a partial failure with exact counts for each outcome", () => {
    const summary = summarizeResults([
      { outcome: "sent" },
      { outcome: "sent" },
      { outcome: "failed", error: "x" },
      { skipped: true, reason: "y" },
    ]);
    const message = describeBulkSummary(summary, "reminder");
    expect(message).toBe("2 reminders sent, 1 skipped, 1 failed.");
  });

  it("singularizes the verb when exactly one was sent", () => {
    const summary = summarizeResults([{ outcome: "sent" }, { outcome: "failed", error: "x" }]);
    expect(describeBulkSummary(summary, "invitation")).toBe("1 invitation sent, 1 failed.");
  });
});

describe("latestInviteStatusBySubmission", () => {
  const row = (submissionId: string, outcome: SendLogRow["outcome"], createdAt: string): SendLogRow => ({
    submission_id: submissionId,
    outcome,
    created_at: createdAt,
  });

  it("maps a single attempt straight through", () => {
    const status = latestInviteStatusBySubmission([row("s1", "sent", "2026-11-09T10:00:00Z")]);
    expect(status.get("s1")).toBe("sent");
  });

  it("keeps the most recent attempt when a submission has several, regardless of input order", () => {
    // A failed initial invite followed by a successful resend — fed in
    // out of chronological order, to confirm the function sorts by
    // created_at itself rather than trusting array order.
    const status = latestInviteStatusBySubmission([
      row("s1", "sent", "2026-11-09T12:00:00Z"),
      row("s1", "failed", "2026-11-09T10:00:00Z"),
    ]);
    expect(status.get("s1")).toBe("sent");
  });

  it("reflects a resend that regressed from sent to failed", () => {
    const status = latestInviteStatusBySubmission([
      row("s1", "sent", "2026-11-09T10:00:00Z"),
      row("s1", "failed", "2026-11-09T12:00:00Z"),
    ]);
    expect(status.get("s1")).toBe("failed");
  });

  it("tracks multiple submissions independently", () => {
    const status = latestInviteStatusBySubmission([
      row("s1", "sent", "2026-11-09T10:00:00Z"),
      row("s2", "failed", "2026-11-09T10:00:00Z"),
      row("s3", "mocked", "2026-11-09T10:00:00Z"),
    ]);
    expect(status.get("s1")).toBe("sent");
    expect(status.get("s2")).toBe("failed");
    expect(status.get("s3")).toBe("mocked");
  });

  it("has no entry at all for a submission with no matching log row — the caller renders that as not_sent", () => {
    const status = latestInviteStatusBySubmission([row("s1", "sent", "2026-11-09T10:00:00Z")]);
    expect(status.has("s2")).toBe(false);
  });

  it("returns an empty map for an empty input", () => {
    expect(latestInviteStatusBySubmission([]).size).toBe(0);
  });
});

describe("latestInviteLogBySubmission", () => {
  const row = (
    submissionId: string,
    outcome: SendLogRow["outcome"],
    createdAt: string,
    sentBy?: string | null,
  ): SendLogRow => ({
    submission_id: submissionId,
    outcome,
    created_at: createdAt,
    sent_by: sentBy,
  });

  it("carries the attributed admin through for the most recent attempt", () => {
    const latest = latestInviteLogBySubmission([row("s1", "sent", "2026-11-09T10:00:00Z", "admin-1")]);
    expect(latest.get("s1")).toEqual({
      submission_id: "s1",
      outcome: "sent",
      created_at: "2026-11-09T10:00:00Z",
      sent_by: "admin-1",
    });
  });

  it("attributes a resend to whoever sent THAT attempt, not the original admin", () => {
    const latest = latestInviteLogBySubmission([
      row("s1", "failed", "2026-11-09T10:00:00Z", "admin-1"),
      row("s1", "sent", "2026-11-09T12:00:00Z", "admin-2"),
    ]);
    expect(latest.get("s1")?.sent_by).toBe("admin-2");
    expect(latest.get("s1")?.outcome).toBe("sent");
  });

  it("surfaces a null/missing sent_by as-is, for rows logged before attribution existed", () => {
    const latest = latestInviteLogBySubmission([row("s1", "sent", "2026-11-09T10:00:00Z", null)]);
    expect(latest.get("s1")?.sent_by).toBeNull();
    const latestUndefined = latestInviteLogBySubmission([row("s2", "sent", "2026-11-09T10:00:00Z")]);
    expect(latestUndefined.get("s2")?.sent_by).toBeUndefined();
  });
});
