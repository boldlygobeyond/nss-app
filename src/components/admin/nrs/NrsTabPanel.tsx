"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Send, Check, Bell, Eye, X, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CLUSTERS, CLUSTER_LABELS, type ClusterKey } from "@/lib/nrs/clusters";
import {
  toRowResult,
  summarizeResults,
  describeBulkSummary,
  latestInviteLogBySubmission,
  inviteEmailStatusLabel,
  type SendResultItem,
  type InviteEmailStatus,
} from "@/lib/nrs/sendOutcome";
import BulkSendConfirmDialog from "./BulkSendConfirmDialog";
import NrsScenarioSelection from "./NrsScenarioSelection";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

type NrsSubmissionStatus = "invited" | "in_progress" | "completed";
// Mirrors sendOutcome.ts's RowResult kinds plus the UI-only "idle"/"sending"
// states — mocked and skipped are their own states, never folded into
// "sent", so a dev-mode mock or a skipped repeat-click can never render
// the same as a real live send.
type SendState = "idle" | "sending" | "sent" | "mocked" | "skipped" | "error";

// One icon per row action (send/resend/remind), each keyed by action so
// clicking one never changes the icon shown on a different button for
// the same person.
type ActionKind = "send" | "resend" | "remind";

function sendStateFromResult(result: ReturnType<typeof toRowResult>): SendState {
  return result.kind === "failed" ? "error" : result.kind;
}

function SendStateIcon({ state, idleIcon }: { state: SendState; idleIcon: ReactNode }) {
  switch (state) {
    case "sending":
      return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    case "sent":
      return <Check className="w-3.5 h-3.5 text-primary" />;
    case "mocked":
      return <Check className="w-3.5 h-3.5 text-muted-foreground" />;
    case "skipped":
      return <Check className="w-3.5 h-3.5 text-muted-foreground opacity-50" />;
    case "error":
      return <X className="w-3.5 h-3.5 text-destructive" />;
    default:
      return <>{idleIcon}</>;
  }
}

function titleForState(state: SendState, idleTitle: string): string | undefined {
  switch (state) {
    case "mocked":
      return "Mocked — dev mode, no real email was sent";
    case "skipped":
      return "Skipped";
    case "error":
      return "Failed — see the error above";
    case "sent":
      return "Sent";
    default:
      return idleTitle;
  }
}

const STATUS_LABEL: Record<NrsSubmissionStatus, string> = {
  invited: "Invited",
  in_progress: "In progress",
  completed: "Completed",
};
const STATUS_COLOR: Record<NrsSubmissionStatus, string> = {
  invited: "bg-muted-foreground/40",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
};

interface NrsSubmissionInfo {
  id: string;
  status: NrsSubmissionStatus;
  invitedAt: string;
  lastReminderAt: string | null;
  completedAt: string | null;
  resonanceScore: number | null;
  // Persistent, independent of the survey-progress status above — see
  // sendOutcome.ts. Derived from nrs_send_log, not nrs_submissions.
  inviteEmailStatus: InviteEmailStatus;
  inviteEmailAt: string | null;
  inviteEmailSentBy: string | null; // resolved display name, or null if unattributed/not sent
}

const INVITE_EMAIL_ICON_CLASS: Record<InviteEmailStatus, string> = {
  sent: "text-primary",
  failed: "text-destructive",
  mocked: "text-muted-foreground",
  not_sent: "text-muted-foreground opacity-30",
};

function inviteEmailTooltip(sub: {
  inviteEmailStatus: InviteEmailStatus;
  inviteEmailAt: string | null;
  inviteEmailSentBy: string | null;
}): string {
  const base = inviteEmailStatusLabel(sub.inviteEmailStatus);
  if (!sub.inviteEmailAt) return base;
  const when = `on ${formatDate(sub.inviteEmailAt)}`;
  return sub.inviteEmailSentBy ? `${base} — ${when}, by ${sub.inviteEmailSentBy}` : `${base} — ${when}`;
}

interface NrsRosterRow {
  rosterId: string;
  firstName: string;
  lastName: string;
  email: string;
  submission: NrsSubmissionInfo | null;
}

export default function NrsTabPanel({ teamId, teamSlug }: { teamId: string; teamSlug: string }) {
  const [configuredClusters, setConfiguredClusters] = useState<Set<ClusterKey> | null>(null);
  const [clusterKey, setClusterKey] = useState<ClusterKey>("Stability");
  const [rows, setRows] = useState<NrsRosterRow[] | null>(null);
  const [sendState, setSendState] = useState<Record<string, SendState>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkDialog, setBulkDialog] = useState<"send" | "remind" | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  // Whether this cluster has a valid saved 10-scenario selection for this
  // team — reported up by NrsScenarioSelection, which owns the actual
  // fetch. Invitations can't be sent until this is true.
  const [hasValidSelection, setHasValidSelection] = useState(false);
  // Two collapsible sections: Scenario Selection (setup) and the
  // participant/invite table (sending). Whenever a valid selection
  // exists — already saved from before, or just saved this session —
  // Scenario Selection auto-collapses and the invite table auto-opens,
  // so the admin lands on "send invites" instead of the setup they just
  // finished. Both stay manually toggleable via their header either way.
  const [scenarioCollapsed, setScenarioCollapsed] = useState(false);
  const [inviteCollapsed, setInviteCollapsed] = useState(true);

  // Which clusters actually have content — loaded once, independent of
  // which one is currently selected.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("nrs_clusters").select("cluster_key, configured").eq("configured", true);
      if (cancelled) return;
      setConfiguredClusters(new Set((data ?? []).map((c) => c.cluster_key as ClusterKey)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = async () => {
    const supabase = createClient();
    // Same team_roster query the Roster tab already runs (filtered by
    // team_id), left-joined client-side against nrs_submissions for the
    // selected cluster — so this tab always shows exactly the same
    // members as Roster, never a separate participant concept.
    const [{ data: roster, error: rosterError }, { data: submissions, error: subError }] = await Promise.all([
      supabase.from("team_roster").select("id, first_name, last_name, email").eq("team_id", teamId).order("first_name"),
      supabase
        .from("nrs_submissions")
        .select("id, roster_id, status, invited_at, last_reminder_at, completed_at, resonance_score")
        .eq("cluster_key", clusterKey),
    ]);
    if (rosterError || subError) {
      setActionError((rosterError ?? subError)?.message ?? "Could not load this cluster's data");
      return;
    }

    // One extra, tightly-scoped query — not one per row — for the
    // persistent email-status beacon: every invitation-type send-log
    // entry (initial invite and any resends both log under that same
    // email_type) for just this cluster's already-loaded submissions.
    // Reminder/results events are deliberately excluded by the
    // email_type filter, per the roster beacon's scope. Skipped
    // entirely when there are no submissions yet, rather than sending a
    // query with an empty .in() filter.
    const submissionIds = (submissions ?? []).map((s) => s.id);
    let latestLog = new Map<string, { outcome: InviteEmailStatus; created_at: string; sent_by?: string | null }>();
    let adminNameById = new Map<string, string>();
    if (submissionIds.length > 0) {
      const { data: sendLogs, error: logError } = await supabase
        .from("nrs_send_log")
        .select("submission_id, outcome, created_at, sent_by")
        .eq("email_type", "invitation")
        .in("submission_id", submissionIds);
      // Non-fatal: the roster still loads correctly without this beacon
      // if the log query itself fails — every submission just falls back
      // to "not_sent" below rather than blocking the whole tab.
      if (logError) console.error("[nrs-tab] failed to load invitation send log:", logError);
      latestLog = latestInviteLogBySubmission(sendLogs ?? []);

      // A second small, tightly-scoped query — only for the distinct
      // admin ids actually referenced by this cluster's latest sends, not
      // one lookup per row. Skipped entirely when nothing needs
      // attributing (e.g. every send predates this, or none exist yet).
      const adminIds = [...new Set([...latestLog.values()].map((l) => l.sent_by).filter((id): id is string => !!id))];
      if (adminIds.length > 0) {
        const { data: admins, error: adminsError } = await supabase
          .from("user_profiles")
          .select("id, first_name, last_name")
          .in("id", adminIds);
        if (adminsError) console.error("[nrs-tab] failed to load sender names:", adminsError);
        adminNameById = new Map(
          (admins ?? []).map((a) => [a.id, [a.first_name, a.last_name].filter(Boolean).join(" ") || "Unknown admin"]),
        );
      }
    }

    const byRosterId = new Map((submissions ?? []).map((s) => [s.roster_id, s]));
    setRows(
      (roster ?? []).map((r) => {
        const s = byRosterId.get(r.id);
        const log = s ? latestLog.get(s.id) : undefined;
        return {
          rosterId: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          submission: s
            ? {
                id: s.id,
                status: s.status as NrsSubmissionStatus,
                invitedAt: s.invited_at,
                lastReminderAt: s.last_reminder_at,
                completedAt: s.completed_at,
                resonanceScore: s.resonance_score,
                inviteEmailStatus: log?.outcome ?? "not_sent",
                inviteEmailAt: log?.created_at ?? null,
                inviteEmailSentBy: log?.sent_by ? (adminNameById.get(log.sent_by) ?? "Unknown admin") : null,
              }
            : null,
        };
      }),
    );
  };

  useEffect(() => {
    (async () => {
      await loadRows();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, clusterKey]);


  // Polled every few seconds so a participant's status dot moves from
  // invited -> in_progress -> completed on its own while they're actually
  // taking the assessment elsewhere, without the admin reloading the page
  // or having to personally trigger an action first — mirrors the
  // Roster tab's equivalent NSS status polling (pollNssStatus in the
  // parent page). Keeps everything else on the row (name/email) as-is;
  // only the submission fields get refreshed. The dashboard metric cards
  // above the table are all derived from `rows` at render time, so they
  // stay live for free too.
  const pollNrsStatus = async () => {
    const supabase = createClient();
    const { data: submissions } = await supabase
      .from("nrs_submissions")
      .select("id, roster_id, status, invited_at, last_reminder_at, completed_at, resonance_score")
      .eq("cluster_key", clusterKey);
    if (!submissions) return;
    const byRosterId = new Map(submissions.map((s) => [s.roster_id, s]));
    setRows((prev) =>
      prev
        ? prev.map((r) => {
            const s = byRosterId.get(r.rosterId);
            return {
              ...r,
              submission: s
                ? {
                    id: s.id,
                    status: s.status as NrsSubmissionStatus,
                    invitedAt: s.invited_at,
                    lastReminderAt: s.last_reminder_at,
                    completedAt: s.completed_at,
                    resonanceScore: s.resonance_score,
                    // Deliberately not re-queried here — the invitation
                    // send log only ever changes as a direct result of an
                    // admin action on this same page (send/resend), and
                    // every such action already calls loadRows() right
                    // after, which refreshes this for real. Re-querying
                    // nrs_send_log (and the admin-name lookup) on every 5s
                    // poll tick as well would be a per-poll database call
                    // for data that, between an admin's own actions, never
                    // changes. Carry the last known values forward instead.
                    inviteEmailStatus: r.submission?.inviteEmailStatus ?? "not_sent",
                    inviteEmailAt: r.submission?.inviteEmailAt ?? null,
                    inviteEmailSentBy: r.submission?.inviteEmailSentBy ?? null,
                  }
                : null,
            };
          })
        : prev,
    );
  };

  useEffect(() => {
    const interval = setInterval(pollNrsStatus, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, clusterKey]);

  // Keyed by rosterId + which action (send/resend/remind), not just
  // rosterId — a row can show two independent action buttons (resend and
  // remind) at once, and clicking one must never change the icon shown
  // on the other.
  const rowKey = (rosterId: string, action: ActionKind) => `${rosterId}:${action}`;

  const setRowState = (rosterId: string, action: ActionKind, state: SendState) => {
    const key = rowKey(rosterId, action);
    setSendState((s) => ({ ...s, [key]: state }));
    if (state !== "idle" && state !== "sending") {
      setTimeout(() => setSendState((s) => ({ ...s, [key]: "idle" })), 2500);
    }
  };

  // Shared by all three single-recipient actions: turns the route's
  // response into one honest RowResult (never defaulting to "sent" just
  // because the HTTP call itself succeeded), reflects it in that one
  // button's icon, and — for anything other than a routine dev-mode mock
  // — surfaces the reason in the error banner too, since the icon alone
  // is easy to miss during a batch of clicks.
  const applySingleResult = (row: NrsRosterRow, action: ActionKind, item: SendResultItem | null | undefined) => {
    const result = toRowResult(item);
    setRowState(row.rosterId, action, sendStateFromResult(result));
    if (result.kind === "failed") {
      setActionError(`${row.firstName} ${row.lastName}: ${result.message || "Could not send"}`);
    } else if (result.kind === "skipped" && result.message) {
      setActionError(`${row.firstName} ${row.lastName}: ${result.message}`);
    }
  };

  const sendIndividual = async (row: NrsRosterRow) => {
    setActionError(null);
    setRowState(row.rosterId, "send", "sending");
    try {
      const res = await fetch("/api/nrs/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug, clusterKey, rosterIds: [row.rosterId] }),
      });
      const body = await res.json().catch(() => null);
      applySingleResult(row, "send", res.ok ? body?.results?.[0] : null);
      await loadRows();
    } catch {
      applySingleResult(row, "send", null);
    }
  };

  const resendInvite = async (row: NrsRosterRow) => {
    if (!row.submission) return;
    const confirmed = window.confirm(
      `${row.firstName} ${row.lastName} was already invited on ${formatDate(row.submission.invitedAt)}. Send the invite again?`,
    );
    if (!confirmed) return;
    setActionError(null);
    setRowState(row.rosterId, "resend", "sending");
    try {
      const res = await fetch("/api/nrs/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: row.submission.id }),
      });
      const body = await res.json().catch(() => null);
      applySingleResult(row, "resend", res.ok ? body : null);
      await loadRows();
    } catch {
      applySingleResult(row, "resend", null);
    }
  };

  const remindOne = async (row: NrsRosterRow) => {
    if (!row.submission) return;
    setActionError(null);
    setRowState(row.rosterId, "remind", "sending");
    try {
      const res = await fetch("/api/nrs/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: row.submission.id }),
      });
      const body = await res.json().catch(() => null);
      applySingleResult(row, "remind", res.ok ? body : null);
      await loadRows();
    } catch {
      applySingleResult(row, "remind", null);
    }
  };

  const notInvited = (rows ?? []).filter((r) => !r.submission);
  const incomplete = (rows ?? []).filter((r) => r.submission && r.submission.status !== "completed");

  const confirmBulkSend = async () => {
    setBulkDialog(null);
    setBulkSending(true);
    setActionError(null);
    try {
      const res = await fetch("/api/nrs/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug, clusterKey, rosterIds: notInvited.map((r) => r.rosterId) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setActionError(body.error || "Could not send invitations");
      } else {
        const body = await res.json().catch(() => ({ results: [] }));
        // A 200 here only means the request was valid, not that every
        // (or any) email actually went out — summarize the real
        // per-recipient outcomes rather than treating "res.ok" as "sent."
        const summary = summarizeResults(body.results ?? []);
        setActionError(describeBulkSummary(summary, "invitation"));
      }
      await loadRows();
    } catch {
      // fetch() itself threw (offline, DNS failure, etc.) rather than
      // returning a non-ok response — same user-facing message either way,
      // since from the admin's seat both just mean "nothing went out."
      setActionError("Could not send invitations. Check your connection and try again.");
    } finally {
      setBulkSending(false);
    }
  };

  const confirmBulkRemind = async () => {
    setBulkDialog(null);
    setBulkSending(true);
    setActionError(null);
    try {
      const res = await fetch("/api/nrs/remind-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug, clusterKey }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setActionError(body.error || "Could not send reminders");
      } else {
        const body = await res.json().catch(() => ({ results: [] }));
        const summary = summarizeResults(body.results ?? []);
        setActionError(describeBulkSummary(summary, "reminder"));
      }
      await loadRows();
    } catch {
      setActionError("Could not send reminders. Check your connection and try again.");
    } finally {
      setBulkSending(false);
    }
  };

  const total = rows?.length ?? 0;
  const completedRows = (rows ?? []).filter((r) => r.submission?.status === "completed");
  const inProgressCount = (rows ?? []).filter((r) => r.submission?.status === "in_progress").length;
  const invitedCount = (rows ?? []).filter((r) => r.submission).length;
  const awaitingCount = invitedCount - completedRows.length;
  const completionPct = total > 0 ? Math.round((completedRows.length / total) * 100) : 0;
  const scores = completedRows.map((r) => r.submission!.resonanceScore).filter((s): s is number => s != null);
  const averageScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—";

  const isConfigured = configuredClusters?.has(clusterKey) ?? false;

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <label htmlFor="nrs-cluster" className="text-xs font-medium text-muted-foreground">
          Cluster
        </label>
        <select
          id="nrs-cluster"
          value={clusterKey}
          onChange={(e) => {
            // Reset to the default collapse state on every cluster
            // switch — NrsScenarioSelection's own status report
            // immediately corrects this to "collapsed + invite open" if
            // the new cluster already has a valid selection.
            setClusterKey(e.target.value as ClusterKey);
            setScenarioCollapsed(false);
            setInviteCollapsed(true);
          }}
          className="h-9 px-3 text-sm border border-border/50 rounded-lg bg-card"
        >
          {CLUSTERS.map((c) => (
            <option key={c} value={c}>
              {CLUSTER_LABELS[c]}
              {configuredClusters && !configuredClusters.has(c) ? " (not yet configured)" : ""}
            </option>
          ))}
        </select>
      </div>

      {!isConfigured && (
        <div className="bg-secondary/40 border border-dashed border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {CLUSTER_LABELS[clusterKey]} doesn&apos;t have any scenarios configured yet.
          </p>
        </div>
      )}

      {isConfigured && (
        <NrsScenarioSelection
          teamId={teamId}
          clusterKey={clusterKey}
          collapsed={scenarioCollapsed}
          onToggleCollapsed={() => setScenarioCollapsed((c) => !c)}
          onSelectionStatusChange={({ hasValidSelection: valid }) => {
            setHasValidSelection(valid);
            if (valid) {
              setScenarioCollapsed(true);
              setInviteCollapsed(false);
            }
          }}
        />
      )}

      {isConfigured && (
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <button
              onClick={() => setInviteCollapsed((c) => !c)}
              className="flex items-center gap-1.5 font-heading text-sm font-semibold text-foreground"
            >
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground transition-transform ${inviteCollapsed ? "-rotate-90" : ""}`}
              />
              Send Invites
            </button>
            {rows && (
              <div className="flex items-center gap-2">
                {notInvited.length > 0 && (
                  <button
                    onClick={() => setBulkDialog("send")}
                    disabled={bulkSending || !hasValidSelection}
                    title={hasValidSelection ? undefined : "Select and save 10 scenarios for this cluster first"}
                    className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" /> Send to all ({notInvited.length})
                  </button>
                )}
                {incomplete.length > 0 && (
                  <button
                    onClick={() => setBulkDialog("remind")}
                    disabled={bulkSending}
                    className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    <Bell className="w-3.5 h-3.5" /> Remind all incomplete ({incomplete.length})
                  </button>
                )}
              </div>
            )}
          </div>

          {!inviteCollapsed && (
            <div className="mt-4">
              {actionError && <p className="text-xs text-destructive mb-3">{actionError}</p>}

              {!rows ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one on the roster yet.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/50 border border-border/50 rounded-xl overflow-hidden mb-6">
            <div className="bg-card p-4">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{total}</p>
              <p className="text-xs text-muted-foreground mt-1">total participants</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{invitedCount}</p>
              <p className="text-xs text-muted-foreground mt-1">invited</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{inProgressCount}</p>
              <p className="text-xs text-muted-foreground mt-1">in progress</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{completedRows.length}</p>
              <p className="text-xs text-muted-foreground mt-1">completed</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{awaitingCount}</p>
              <p className="text-xs text-muted-foreground mt-1">awaiting completion</p>
            </div>
            <div className="bg-card p-4">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{completionPct}%</p>
              <p className="text-xs text-muted-foreground mt-1">of team completed</p>
            </div>
            <div className="bg-card p-4 col-span-2">
              <p className="text-2xl font-semibold text-foreground tabular-nums">{averageScore}</p>
              <p className="text-xs text-muted-foreground mt-1">average resonance score</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full border-collapse">
              <thead className="bg-secondary">
                <tr>
                  <th className="p-3 w-8" />
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">NRS Status</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invited</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last Reminder</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Completed</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="bg-card">
                {rows.map((row) => {
                  const sendState_ = sendState[rowKey(row.rosterId, "send")] ?? "idle";
                  const resendState = sendState[rowKey(row.rosterId, "resend")] ?? "idle";
                  const remindState = sendState[rowKey(row.rosterId, "remind")] ?? "idle";
                  const sub = row.submission;
                  return (
                    <tr key={row.rosterId} className="border-b border-border/30 last:border-0">
                      <td className="p-3">
                        {sub && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`block w-2.5 h-2.5 rounded-full ${STATUS_COLOR[sub.status]}`}
                              title={STATUS_LABEL[sub.status]}
                            />
                            {/* Compact, persistent invitation-email indicator — independent
                                of the survey-progress dot above. See sendOutcome.ts. */}
                            <span title={inviteEmailTooltip(sub)} className="inline-flex">
                              <Mail className={`w-3 h-3 ${INVITE_EMAIL_ICON_CLASS[sub.inviteEmailStatus]}`} />
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-sm text-foreground whitespace-nowrap">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                        {sub ? STATUS_LABEL[sub.status] : "Not invited"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                        {sub ? formatDate(sub.invitedAt) : "—"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                        {sub?.lastReminderAt ? formatDate(sub.lastReminderAt) : "—"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                        {sub?.completedAt ? formatDate(sub.completedAt) : "—"}
                      </td>
                      <td className="p-3 text-sm text-foreground tabular-nums whitespace-nowrap">
                        {sub?.resonanceScore != null ? `${sub.resonanceScore.toFixed(1)} / 5` : "—"}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          {!sub ? (
                            <button
                              onClick={() => sendIndividual(row)}
                              disabled={sendState_ === "sending" || !hasValidSelection}
                              title={
                                hasValidSelection
                                  ? titleForState(sendState_, "Send invite")
                                  : "Select and save 10 scenarios for this cluster first"
                              }
                              className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                            >
                              <SendStateIcon state={sendState_} idleIcon={<Send className="w-3.5 h-3.5" />} />
                            </button>
                          ) : sub.status === "completed" ? (
                            <Link href={`/admin/teams/${teamSlug}/nrs/${clusterKey}/${sub.id}`}>
                              <button
                                title="View responses"
                                className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </Link>
                          ) : (
                            <>
                              <button
                                onClick={() => resendInvite(row)}
                                disabled={resendState === "sending"}
                                title={titleForState(resendState, "Resend invite")}
                                className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                              >
                                <SendStateIcon state={resendState} idleIcon={<Send className="w-3.5 h-3.5" />} />
                              </button>
                              <button
                                onClick={() => remindOne(row)}
                                disabled={remindState === "sending"}
                                title={titleForState(remindState, "Send reminder")}
                                className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                              >
                                <SendStateIcon state={remindState} idleIcon={<Bell className="w-3.5 h-3.5" />} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <BulkSendConfirmDialog
        open={bulkDialog === "send"}
        title="Send invitations to all pending participants?"
        description={`This sends the ${CLUSTER_LABELS[clusterKey]} invitation email to ${notInvited.length} participant${notInvited.length === 1 ? "" : "s"} who haven't been invited yet.`}
        confirmLabel={`Send to ${notInvited.length}`}
        onCancel={() => setBulkDialog(null)}
        onConfirm={confirmBulkSend}
      />
      <BulkSendConfirmDialog
        open={bulkDialog === "remind"}
        title="Remind all incomplete participants?"
        description={`This sends the reminder email to ${incomplete.length} participant${incomplete.length === 1 ? "" : "s"} who are invited but haven't completed this scan yet.`}
        confirmLabel={`Remind ${incomplete.length}`}
        onCancel={() => setBulkDialog(null)}
        onConfirm={confirmBulkRemind}
      />
    </div>
  );
}
