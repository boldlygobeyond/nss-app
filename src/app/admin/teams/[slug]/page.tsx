"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert, Send, Check, FileText, BarChart3, RotateCw, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, listAllProfiles } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { rosterRowsFromGrid } from "@/lib/nss/rosterCsv";
import { fetchRosterGridForSpreadsheet } from "@/lib/nss/googlePicker";
import GlobalHeader from "@/components/GlobalHeader";

interface Team {
  id: string;
  name: string;
  slug: string;
  drive_spreadsheet_id: string | null;
}

interface RosterEntry {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  manager_email: string;
  invited_at: string | null;
  missing_from_sheet: boolean;
}

interface ReportEntry {
  id: string;
  respondent_name: string;
  user_email: string | null;
  user_id: string;
  completedAt: string | null;
}

type Tab = "roster" | "reports" | "snapshot";
type SendState = "idle" | "sending" | "sent" | "error";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function TeamWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);
  const [tab, setTab] = useState<Tab>("roster");

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { first_name: string | null; last_name: string | null }>>({});

  const [sendState, setSendState] = useState<Record<string, SendState>>({});
  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<string | null>(null);
  const [resyncError, setResyncError] = useState<string | null>(null);

  const loadRoster = async (teamId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("team_roster")
      .select("id, first_name, last_name, email, manager_email, invited_at, missing_from_sheet")
      .eq("team_id", teamId)
      .order("last_name");
    setRoster(data ?? []);
  };

  const loadReports = async () => {
    const supabase = createClient();
    const { data: submissions } = await supabase
      .from("nss_submissions")
      .select("id, respondent_name, user_email, user_id")
      .eq("team", slug)
      .in("status", ["completed", "report_generated"]);

    const allResponses = await fetchAllRows<{ submission_id: string; answered_at: string }>((from, to) =>
      supabase.from("nss_responses").select("submission_id, answered_at").order("id").range(from, to),
    );
    const lastAnswered: Record<string, string> = {};
    allResponses.forEach((r) => {
      if (!lastAnswered[r.submission_id] || r.answered_at > lastAnswered[r.submission_id]) {
        lastAnswered[r.submission_id] = r.answered_at;
      }
    });

    setReports(
      (submissions ?? [])
        .map((s) => ({ ...s, completedAt: lastAnswered[s.id] ?? null }))
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    );

    const allProfiles = await listAllProfiles(supabase);
    setProfiles(Object.fromEntries(allProfiles.map((p) => [p.id, p])));
  };

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const myProfile = await getMyProfile(supabase, user.id);
      if (myProfile?.role !== "admin") {
        setLoading(false);
        return;
      }
      setAuthorized(true);

      const { data: teamRow } = await supabase
        .from("teams")
        .select("id, name, slug, drive_spreadsheet_id")
        .eq("slug", slug)
        .maybeSingle();
      if (!teamRow) {
        setLoading(false);
        return;
      }
      setTeam(teamRow);
      await Promise.all([loadRoster(teamRow.id), loadReports()]);
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const sendInvite = async (entry: RosterEntry) => {
    setSendState((s) => ({ ...s, [entry.id]: "sending" }));
    const res = await fetch("/api/nss/team-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: entry.first_name,
        lastName: entry.last_name,
        email: entry.email,
        team: slug,
        managerEmail: entry.manager_email,
      }),
    });
    setSendState((s) => ({ ...s, [entry.id]: res.ok ? "sent" : "error" }));
    if (res.ok && team) {
      await loadRoster(team.id);
      setTimeout(() => setSendState((s) => ({ ...s, [entry.id]: "idle" })), 2000);
    }
  };

  const sendAllPending = async () => {
    const pending = roster.filter((r) => !r.invited_at);
    for (const entry of pending) {
      await sendInvite(entry);
    }
  };

  const handleResync = async () => {
    if (!team?.drive_spreadsheet_id) return;
    setResyncing(true);
    setResyncResult(null);
    setResyncError(null);
    try {
      const grid = await fetchRosterGridForSpreadsheet(team.drive_spreadsheet_id);
      const { rows, errors } = rosterRowsFromGrid(grid);
      if (errors.length > 0) {
        setResyncError(errors.join(" "));
        return;
      }
      const res = await fetch(`/api/nss/teams/${team.slug}/resync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not resync from the sheet.");
      }
      const result = (await res.json()) as { added: number; updated: number; missing: number };
      const parts = [
        result.added > 0 && `${result.added} added`,
        result.updated > 0 && `${result.updated} updated`,
        result.missing > 0 && `${result.missing} no longer in the sheet`,
      ].filter(Boolean);
      setResyncResult(parts.length > 0 ? parts.join(", ") : "No changes — roster already matches the sheet.");
      await loadRoster(team.id);
    } catch (err) {
      setResyncError(err instanceof Error ? err.message : "Could not resync from the sheet.");
    } finally {
      setResyncing(false);
    }
  };

  const pendingCount = roster.filter((r) => !r.invited_at).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-4xl mx-auto px-6 py-12 w-full">
        {loading ? (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authorized ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        ) : !team ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <p className="text-muted-foreground text-sm">No team found for &quot;{slug}&quot;.</p>
          </div>
        ) : (
          <>
            <h1 className="font-heading text-2xl font-bold text-foreground mb-1">{team.name}</h1>
            <p className="text-sm text-muted-foreground mb-6">{roster.length} on roster · {pendingCount} not yet invited</p>

            <div className="flex items-center gap-1 bg-card border border-border/50 rounded-lg p-1 mb-8 w-fit">
              {([
                ["roster", "Roster"],
                ["reports", "Reports"],
                ["snapshot", "Team Snapshot"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                    tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "roster" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading text-sm font-semibold text-foreground">Roster</h2>
                  <div className="flex items-center gap-2">
                    {team.drive_spreadsheet_id && (
                      <button
                        onClick={handleResync}
                        disabled={resyncing}
                        className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                      >
                        {resyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                        Resync from sheet
                      </button>
                    )}
                    {pendingCount > 0 && (
                      <button
                        onClick={sendAllPending}
                        className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" /> Send all pending ({pendingCount})
                      </button>
                    )}
                  </div>
                </div>
                {resyncResult && <p className="text-xs text-muted-foreground mb-3">{resyncResult}</p>}
                {resyncError && <p className="text-xs text-destructive mb-3">{resyncError}</p>}

                <div className="overflow-x-auto rounded-xl border border-border/50 mb-6">
                  <table className="w-full border-collapse">
                    <thead className="bg-secondary">
                      <tr>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manager</th>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody className="bg-card">
                      {roster.map((entry) => {
                        const state = sendState[entry.id] ?? "idle";
                        return (
                          <tr key={entry.id} className="border-b border-border/30 last:border-0">
                            <td className="p-3 text-sm text-foreground">
                              {entry.first_name} {entry.last_name}
                              {entry.missing_from_sheet && (
                                <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Not in sheet
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-sm text-muted-foreground">{entry.email}</td>
                            <td className="p-3 text-sm text-muted-foreground">{entry.manager_email}</td>
                            <td className="p-3 text-sm text-muted-foreground">
                              {entry.invited_at ? `Invited ${formatDate(entry.invited_at)}` : "Not invited"}
                            </td>
                            <td className="p-3">
                              <button
                                onClick={() => sendInvite(entry)}
                                disabled={state === "sending"}
                                className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                              >
                                {state === "sending" ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : state === "sent" ? (
                                  <Check className="w-3.5 h-3.5 text-primary" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                                {entry.invited_at ? "Resend" : "Invite"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "reports" && (
              <div>
                <h2 className="font-heading text-sm font-semibold text-foreground mb-3">Reports</h2>
                {reports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No completed reports yet.</p>
                ) : (
                  <div className="space-y-2">
                    {reports.map((r) => {
                      const profile = profiles[r.user_id];
                      const fullName = buildFullName(profile?.first_name, profile?.last_name, r.respondent_name);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-4 bg-card border border-border/50 rounded-xl p-4"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{fullName}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.completedAt ? formatDate(r.completedAt) : "In progress"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Link href={`/admin/reports/${r.id}/insights`}>
                              <button className="text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors">
                                Insights
                              </button>
                            </Link>
                            <Link href={`/reports/${r.id}`}>
                              <button className="text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors">
                                View
                              </button>
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "snapshot" && (
              <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-foreground text-sm font-medium mb-1">Team Snapshot — coming soon</p>
                <p className="text-muted-foreground text-sm">Still designing this view.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
