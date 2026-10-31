"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Send, Check, Bell, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CLUSTERS, CLUSTER_LABELS, type ClusterKey } from "@/lib/nrs/clusters";
import BulkSendConfirmDialog from "./BulkSendConfirmDialog";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

type NrsSubmissionStatus = "invited" | "in_progress" | "completed";
type SendState = "idle" | "sending" | "sent" | "error";

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

    const byRosterId = new Map((submissions ?? []).map((s) => [s.roster_id, s]));
    setRows(
      (roster ?? []).map((r) => {
        const s = byRosterId.get(r.id);
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

  const setRowState = (rosterId: string, state: SendState) => {
    setSendState((s) => ({ ...s, [rosterId]: state }));
    if (state === "sent" || state === "error") {
      setTimeout(() => setSendState((s) => ({ ...s, [rosterId]: "idle" })), 2000);
    }
  };

  const sendIndividual = async (row: NrsRosterRow) => {
    setActionError(null);
    setRowState(row.rosterId, "sending");
    try {
      const res = await fetch("/api/nrs/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug, clusterKey, rosterIds: [row.rosterId] }),
      });
      const body = await res.json();
      const outcome = body?.results?.[0]?.outcome;
      setRowState(row.rosterId, res.ok && outcome !== "failed" ? "sent" : "error");
      await loadRows();
    } catch {
      setRowState(row.rosterId, "error");
    }
  };

  const resendInvite = async (row: NrsRosterRow) => {
    if (!row.submission) return;
    const confirmed = window.confirm(
      `${row.firstName} ${row.lastName} was already invited on ${formatDate(row.submission.invitedAt)}. Send the invite again?`,
    );
    if (!confirmed) return;
    setActionError(null);
    setRowState(row.rosterId, "sending");
    try {
      const res = await fetch("/api/nrs/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: row.submission.id }),
      });
      setRowState(row.rosterId, res.ok ? "sent" : "error");
      await loadRows();
    } catch {
      setRowState(row.rosterId, "error");
    }
  };

  const remindOne = async (row: NrsRosterRow) => {
    if (!row.submission) return;
    setActionError(null);
    setRowState(row.rosterId, "sending");
    try {
      const res = await fetch("/api/nrs/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: row.submission.id }),
      });
      const body = await res.json();
      if (body?.skipped) {
        setActionError(`${row.firstName} ${row.lastName}: ${body.reason}`);
        setRowState(row.rosterId, "idle");
      } else {
        setRowState(row.rosterId, res.ok ? "sent" : "error");
      }
      await loadRows();
    } catch {
      setRowState(row.rosterId, "error");
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
      }
      await loadRows();
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
      }
      await loadRows();
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
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="nrs-cluster" className="text-xs font-medium text-muted-foreground">
            Cluster
          </label>
          <select
            id="nrs-cluster"
            value={clusterKey}
            onChange={(e) => setClusterKey(e.target.value as ClusterKey)}
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

        {isConfigured && rows && (
          <div className="flex items-center gap-2">
            {notInvited.length > 0 && (
              <button
                onClick={() => setBulkDialog("send")}
                disabled={bulkSending}
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

      {actionError && <p className="text-xs text-destructive mb-3">{actionError}</p>}

      {!isConfigured ? (
        <div className="bg-secondary/40 border border-dashed border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {CLUSTER_LABELS[clusterKey]} doesn&apos;t have any scenarios configured yet.
          </p>
        </div>
      ) : !rows ? (
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
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
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
                  const state = sendState[row.rosterId] ?? "idle";
                  const sub = row.submission;
                  return (
                    <tr key={row.rosterId} className="border-b border-border/30 last:border-0">
                      <td className="p-3">
                        {sub && <span className={`block w-2.5 h-2.5 rounded-full ${STATUS_COLOR[sub.status]}`} />}
                      </td>
                      <td className="p-3 text-sm text-foreground whitespace-nowrap">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground break-all">{row.email}</td>
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
                              disabled={state === "sending"}
                              title="Send invite"
                              className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                            >
                              {state === "sending" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : state === "sent" ? (
                                <Check className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
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
                                disabled={state === "sending"}
                                title="Resend invite"
                                className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                              >
                                {state === "sending" ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : state === "sent" ? (
                                  <Check className="w-3.5 h-3.5 text-primary" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => remindOne(row)}
                                disabled={state === "sending"}
                                title="Send reminder"
                                className="flex items-center justify-center h-8 w-8 shrink-0 border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                              >
                                <Bell className="w-3.5 h-3.5" />
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
