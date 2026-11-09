import { describe, expect, it } from "vitest";
import { toTeamInviteRowResult, latestTeamInviteLogByRoster, type SendLogRow } from "../sendOutcome";

describe("toTeamInviteRowResult", () => {
  it("treats a non-ok response as failed regardless of body", () => {
    expect(toTeamInviteRowResult(false, { outcome: "sent" })).toEqual({ kind: "failed", message: undefined });
  });

  it("surfaces the error message on a non-ok response", () => {
    expect(toTeamInviteRowResult(false, { error: "Team not found" })).toEqual({
      kind: "failed",
      message: "Team not found",
    });
  });

  it("treats outcome: sent on an ok response as sent", () => {
    expect(toTeamInviteRowResult(true, { outcome: "sent" })).toEqual({ kind: "sent" });
  });

  it("treats outcome: mocked as mocked, never as a plain success", () => {
    expect(toTeamInviteRowResult(true, { outcome: "mocked" })).toEqual({ kind: "mocked" });
  });

  it("treats outcome: failed on an ok response as failed", () => {
    expect(toTeamInviteRowResult(true, { outcome: "failed" })).toEqual({ kind: "failed", message: undefined });
  });

  it("treats a null body as failed rather than defaulting to sent", () => {
    expect(toTeamInviteRowResult(true, null)).toEqual({ kind: "failed", message: undefined });
  });
});

describe("latestTeamInviteLogByRoster", () => {
  const row = (rosterId: string, outcome: SendLogRow["outcome"], createdAt: string, sentBy?: string | null): SendLogRow => ({
    roster_id: rosterId,
    outcome,
    created_at: createdAt,
    sent_by: sentBy,
  });

  it("maps a single attempt straight through", () => {
    const latest = latestTeamInviteLogByRoster([row("r1", "sent", "2026-11-09T10:00:00Z", "admin-1")]);
    expect(latest.get("r1")).toEqual({
      roster_id: "r1",
      outcome: "sent",
      created_at: "2026-11-09T10:00:00Z",
      sent_by: "admin-1",
    });
  });

  it("keeps the most recent attempt regardless of input order", () => {
    const latest = latestTeamInviteLogByRoster([
      row("r1", "sent", "2026-11-09T12:00:00Z"),
      row("r1", "failed", "2026-11-09T10:00:00Z"),
    ]);
    expect(latest.get("r1")?.outcome).toBe("sent");
  });

  it("attributes a resend to whoever sent that attempt, not the original admin", () => {
    const latest = latestTeamInviteLogByRoster([
      row("r1", "failed", "2026-11-09T10:00:00Z", "admin-1"),
      row("r1", "sent", "2026-11-09T12:00:00Z", "admin-2"),
    ]);
    expect(latest.get("r1")?.sent_by).toBe("admin-2");
  });

  it("tracks multiple roster members independently", () => {
    const latest = latestTeamInviteLogByRoster([
      row("r1", "sent", "2026-11-09T10:00:00Z"),
      row("r2", "failed", "2026-11-09T10:00:00Z"),
      row("r3", "mocked", "2026-11-09T10:00:00Z"),
    ]);
    expect(latest.get("r1")?.outcome).toBe("sent");
    expect(latest.get("r2")?.outcome).toBe("failed");
    expect(latest.get("r3")?.outcome).toBe("mocked");
  });

  it("has no entry at all for a roster member with no matching log row", () => {
    const latest = latestTeamInviteLogByRoster([row("r1", "sent", "2026-11-09T10:00:00Z")]);
    expect(latest.has("r2")).toBe(false);
  });

  it("returns an empty map for an empty input", () => {
    expect(latestTeamInviteLogByRoster([]).size).toBe(0);
  });
});
