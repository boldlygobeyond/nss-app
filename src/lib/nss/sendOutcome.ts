// NSS's counterpart to src/lib/nrs/sendOutcome.ts — deliberately a
// separate, parallel file rather than a shared generic abstraction,
// matching how this codebase already keeps NSS and NRS as independently
// evolving siblings rather than forcing one coupled core. The one real
// difference from NRS: NSS's team-invite route always returns HTTP 200
// with a bare { outcome, isNewAccount } body (no results array — it only
// ever sends to one recipient per call), and there's no "skipped" concept
// at all (NSS has no reminder-cooldown logic the way NRS does).

export type NssEmailOutcome = "sent" | "mocked" | "failed";

export type TeamInviteRowResult = { kind: "sent" } | { kind: "mocked" } | { kind: "failed"; message?: string };

/**
 * Normalizes the team-invite route's response into one honest result. A
 * non-ok HTTP response (validation failure, team not found, etc.) is
 * always a failure regardless of body shape; an ok response still checks
 * the actual outcome field rather than treating 200 itself as "sent."
 */
export function toTeamInviteRowResult(
  resOk: boolean,
  body: { outcome?: NssEmailOutcome; error?: string } | null,
): TeamInviteRowResult {
  if (!resOk) return { kind: "failed", message: body?.error };
  if (body?.outcome === "sent") return { kind: "sent" };
  if (body?.outcome === "mocked") return { kind: "mocked" };
  return { kind: "failed", message: body?.error };
}

// ── Persistent invitation-email status (roster beacon) ─────────────────────
//
// Same rationale as NRS's equivalent: team_roster.invited_at is stamped
// the moment a send is *attempted*, independent of whether it actually
// succeeded, so a failed or mocked invite looks identical to a real one
// once the moment-of-click toast fades or the page reloads.
// nss_send_log has the real answer; this reads it persistently.

export type InviteEmailStatus = "sent" | "failed" | "mocked" | "not_sent";

export interface SendLogRow {
  roster_id: string;
  outcome: NssEmailOutcome;
  created_at: string;
  sent_by?: string | null;
}

/**
 * Reduces nss_send_log rows — already filtered by the caller to
 * email_type = 'team_invite' and roster_id in (...) — down to one row per
 * roster member: their single most recent attempt, in full (outcome,
 * when, and who). Rows don't need to arrive pre-sorted — this compares
 * created_at itself, so a caller's query order is never load-bearing.
 */
export function latestTeamInviteLogByRoster(rows: SendLogRow[]): Map<string, SendLogRow> {
  const latest = new Map<string, SendLogRow>();
  for (const row of rows) {
    const existing = latest.get(row.roster_id);
    if (!existing || row.created_at > existing.created_at) {
      latest.set(row.roster_id, row);
    }
  }
  return latest;
}

export function inviteEmailStatusLabel(status: InviteEmailStatus): string {
  switch (status) {
    case "sent":
      return "Invite email: sent (accepted by Resend)";
    case "failed":
      return "Invite email: latest attempt failed";
    case "mocked":
      return "Invite email: simulated (mock mode) — not actually sent";
    case "not_sent":
      return "Invite email: no send attempt recorded";
  }
}
