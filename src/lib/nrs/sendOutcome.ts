// Every NRS send route (invite, resend-invite, remind, remind-all) always
// answers with HTTP 200 once past request validation — a per-recipient
// email failure is reported inside the response body, not via status
// code. The admin UI's original "send one invite" button read that body
// correctly; every other send action (bulk send, bulk remind, resend,
// remind) only checked `res.ok`, which is true regardless of whether the
// email actually went out — so a failed or merely-mocked send could show
// as a plain success. This module is the one place that turns any of
// those routes' response shapes into a single, honest result, so no
// caller can accidentally fall back to "ok therefore sent."

export type SendOutcome = "sent" | "mocked" | "failed";

// The three response shapes these routes actually return:
//   invite / remind-all (bulk):      one of these per array entry
//   resend-invite (single):          the bare object itself
//   remind (single):                 the bare object itself
export interface SendResultItem {
  outcome?: SendOutcome;
  skipped?: boolean;
  error?: string;
  reason?: string;
}

export type RowResult =
  | { kind: "sent" }
  | { kind: "mocked" }
  | { kind: "skipped"; message?: string }
  | { kind: "failed"; message?: string };

/**
 * Normalizes one item (a bare response body, or one entry of a
 * `results` array) into a single outcome. A missing/malformed item is
 * treated as a failure, never as a silent success — there is no
 * response shape for which "we don't know" should render as "sent."
 */
export function toRowResult(item: SendResultItem | null | undefined): RowResult {
  if (!item) return { kind: "failed", message: "No response from the server" };
  if (item.skipped) return { kind: "skipped", message: item.reason };
  if (item.outcome === "sent") return { kind: "sent" };
  if (item.outcome === "mocked") return { kind: "mocked" };
  return { kind: "failed", message: item.error };
}

export interface BulkSummary {
  sent: number;
  mocked: number;
  skipped: number;
  failed: number;
  failedMessages: string[];
}

export function summarizeResults(items: Array<SendResultItem | null | undefined>): BulkSummary {
  const summary: BulkSummary = { sent: 0, mocked: 0, skipped: 0, failed: 0, failedMessages: [] };
  for (const item of items) {
    const result = toRowResult(item);
    summary[result.kind] += 1;
    if (result.kind === "failed" && result.message) summary.failedMessages.push(result.message);
  }
  return summary;
}

/**
 * A banner line for a bulk action's actual outcome, or null when every
 * recipient was genuinely sent live — the one case worth staying silent
 * about. Mocked sends are always called out by name, even though they
 * aren't "failures," because a bulk send that was quietly all-mocked
 * (e.g. NRS_EMAIL_MODE left on in an environment that shouldn't have it)
 * must never read the same as a real send to the whole roster.
 */
export function describeBulkSummary(summary: BulkSummary, verb: "invitation" | "reminder"): string | null {
  if (summary.mocked === 0 && summary.skipped === 0 && summary.failed === 0) return null;

  const parts: string[] = [`${summary.sent} ${verb}${summary.sent === 1 ? "" : "s"} sent`];
  if (summary.mocked > 0) parts.push(`${summary.mocked} mocked (dev mode — no real email sent)`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  return parts.join(", ") + ".";
}

// ── Persistent invitation-email status (roster beacon) ─────────────────────
//
// The roster's survey-progress dot (invited/in_progress/completed) comes
// from nrs_submissions.status, which is written the moment a submission
// row is created — before the invite email is even attempted. So a
// submission whose invite email genuinely failed to send still shows the
// same "Invited" dot as one that sent cleanly, with nothing in the UI
// distinguishing them once the moment-of-click toast feedback above has
// faded or the page has been reloaded. nrs_send_log already has the real
// answer; this just reads it persistently instead of only at send-time.

export type InviteEmailStatus = "sent" | "failed" | "mocked" | "not_sent";

export interface SendLogRow {
  submission_id: string;
  outcome: SendOutcome;
  created_at: string;
  // Populated going forward (requireAdmin() now returns the acting
  // admin's id, threaded through to logNrsSend) — absent/null on rows
  // logged before that existed, which the caller should render as
  // "unknown," not as a different admin.
  sent_by?: string | null;
}

/**
 * Reduces nrs_send_log rows — already filtered by the caller to
 * email_type = 'invitation', which covers both the original invite and
 * any resends, since resend-invite logs under that same email_type — down
 * to one row per submission: each submission's single most recent
 * attempt, in full (outcome, when, and who). A resend that later
 * succeeds after an earlier failure correctly overwrites the stale
 * "failed" row, and vice versa.
 *
 * Rows don't need to arrive pre-sorted — this compares created_at itself,
 * so a caller's query order (or a test's deliberately out-of-order input)
 * is never load-bearing. A submission with no matching row at all is
 * simply absent from the returned map — the caller decides how to render
 * "no attempt recorded" (see inviteEmailStatusLabel below), since that's
 * a statement about a submission, not about a log row.
 */
export function latestInviteLogBySubmission(rows: SendLogRow[]): Map<string, SendLogRow> {
  const latest = new Map<string, SendLogRow>();
  for (const row of rows) {
    const existing = latest.get(row.submission_id);
    if (!existing || row.created_at > existing.created_at) {
      latest.set(row.submission_id, row);
    }
  }
  return latest;
}

/** The outcome-only view of latestInviteLogBySubmission, for callers that don't need attribution. */
export function latestInviteStatusBySubmission(rows: SendLogRow[]): Map<string, InviteEmailStatus> {
  const status = new Map<string, InviteEmailStatus>();
  for (const [submissionId, row] of latestInviteLogBySubmission(rows)) {
    status.set(submissionId, row.outcome);
  }
  return status;
}

export function inviteEmailStatusLabel(status: InviteEmailStatus): string {
  switch (status) {
    case "sent":
      return "Invitation email: sent (accepted by Resend)";
    case "failed":
      return "Invitation email: latest attempt failed";
    case "mocked":
      return "Invitation email: simulated (mock mode) — not actually sent";
    case "not_sent":
      return "Invitation email: no send attempt recorded";
  }
}
