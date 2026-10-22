"use client";

import { use, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  ShieldAlert,
  Send,
  Check,
  BarChart3,
  RotateCw,
  AlertTriangle,
  Trash2,
  Minus,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, listAllProfiles } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { rosterRowsFromGrid } from "@/lib/nss/rosterCsv";
import { fetchRosterGridForSpreadsheet } from "@/lib/nss/googlePicker";
import type { ClusterKey } from "@/lib/nss/clusters";
import type { BtResponse } from "@/lib/nss/bradleyTerry";
import { computeTeamMemberScores, computeTeamRowOrder, type TeamMemberScore } from "@/lib/nss/teamScores";
import TeamNeedsHeatmap from "@/components/teams/TeamNeedsHeatmap";
import NeedsSpectrum from "@/components/teams/NeedsSpectrum";
import GlobalHeader from "@/components/GlobalHeader";

interface Team {
  id: string;
  name: string;
  slug: string;
  drive_spreadsheet_id: string | null;
  drive_folder_id: string | null;
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

type NssStatus = "not_started" | "in_progress" | "complete";
const NSS_STATUS_RANK: Record<string, number> = { in_progress: 1, completed: 2, report_generated: 2 };
const NSS_STATUS_LABEL: Record<NssStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
};
const NSS_STATUS_COLOR: Record<NssStatus, string> = {
  not_started: "bg-muted-foreground/40",
  in_progress: "bg-amber-500",
  complete: "bg-emerald-500",
};

type Tab = "roster" | "reports" | "snapshot";
type SendState = "idle" | "sending" | "sent" | "error";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function isTab(value: string | null): value is Tab {
  return value === "roster" || value === "reports" || value === "snapshot";
}

interface OrgTreeNode {
  entry: RosterEntry;
  report: ReportEntry | null;
  children: OrgTreeNode[];
}

// Builds the manager hierarchy straight from the roster's own manager_email
// column — no separate "org chart" data to maintain. A roster row becomes
// a root when its manager isn't anyone else on the roster (an external or
// not-yet-added manager), so there can be more than one top-level box.
function buildOrgForest(roster: RosterEntry[], reportsByEmail: Record<string, ReportEntry>): OrgTreeNode[] {
  const byEmail = new Map(roster.map((r) => [r.email.toLowerCase(), r]));
  const childrenOf = new Map<string, RosterEntry[]>();
  const hasParent = new Set<string>();

  roster.forEach((r) => {
    const email = r.email.toLowerCase();
    const managerEmail = r.manager_email?.trim().toLowerCase();
    if (managerEmail && managerEmail !== email && byEmail.has(managerEmail)) {
      hasParent.add(email);
      const list = childrenOf.get(managerEmail) ?? [];
      list.push(r);
      childrenOf.set(managerEmail, list);
    }
  });

  const visited = new Set<string>();
  const byFirstName = (a: RosterEntry, b: RosterEntry) => a.first_name.localeCompare(b.first_name);

  function buildNode(entry: RosterEntry): OrgTreeNode {
    visited.add(entry.email.toLowerCase());
    // The visited check also guards against a manager_email cycle (A
    // reports to B, B reports to A) recursing forever — whichever side
    // of the cycle renders first claims the node, the other side just
    // won't re-list it as a child.
    const kids = (childrenOf.get(entry.email.toLowerCase()) ?? [])
      .filter((c) => !visited.has(c.email.toLowerCase()))
      .sort(byFirstName);
    return {
      entry,
      report: reportsByEmail[entry.email.toLowerCase()] ?? null,
      children: kids.map(buildNode),
    };
  }

  const forest = roster
    .filter((r) => !hasParent.has(r.email.toLowerCase()))
    .sort(byFirstName)
    .map(buildNode);

  // A pure manager cycle leaves every row in it without a "no manager
  // found" root to hang off of — surface those as extra top-level boxes
  // instead of silently dropping someone's report from the chart.
  roster
    .filter((r) => !visited.has(r.email.toLowerCase()))
    .sort(byFirstName)
    .forEach((r) => forest.push(buildNode(r)));

  return forest;
}

function OrgBox({
  node,
  profiles,
}: {
  node: OrgTreeNode;
  profiles: Record<string, { first_name: string | null; last_name: string | null }>;
}) {
  const { entry, report } = node;
  const fullName = report
    ? buildFullName(profiles[report.user_id]?.first_name, profiles[report.user_id]?.last_name, report.respondent_name)
    : `${entry.first_name} ${entry.last_name}`.trim();

  return (
    <div className="bg-card border border-border/50 rounded-xl p-3 w-44 text-center shadow-sm shrink-0">
      <p className="text-sm font-medium text-foreground truncate" title={fullName}>
        {fullName}
      </p>
      {report ? (
        <>
          <p className="text-xs text-muted-foreground mt-0.5">
            {report.completedAt ? formatDate(report.completedAt) : "In progress"}
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Link href={`/admin/reports/${report.id}/insights`}>
              <button className="text-[11px] font-medium border border-border/50 rounded-lg px-2 py-1 hover:bg-secondary transition-colors">
                Insights
              </button>
            </Link>
            <Link href={`/reports/${report.id}`}>
              <button className="text-[11px] font-medium border border-border/50 rounded-lg px-2 py-1 hover:bg-secondary transition-colors">
                View
              </button>
            </Link>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground mt-0.5">No report yet</p>
      )}
    </div>
  );
}

// Classic nested-list org-chart CSS: each child <li> draws a short stub up
// to a shared horizontal bar (the bar is the union of every sibling's
// ::after segment — trimmed to the half that reaches the outermost
// children, hidden entirely for a lone child).
function OrgNodeRenderer({
  node,
  profiles,
}: {
  node: OrgTreeNode;
  profiles: Record<string, { first_name: string | null; last_name: string | null }>;
}) {
  return (
    <>
      <OrgBox node={node} profiles={profiles} />
      {node.children.length > 0 && (
        <ul className="flex pt-6">
          {node.children.map((child) => (
            <li
              key={child.entry.id}
              className="relative flex flex-col items-center px-3 pt-5 before:content-[''] before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:w-px before:h-5 before:bg-border after:content-[''] after:absolute after:top-0 after:left-0 after:right-0 after:h-px after:bg-border first:after:left-1/2 last:after:right-1/2 only:after:hidden"
            >
              <OrgNodeRenderer node={child} profiles={profiles} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function TeamWorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);
  // Read from the URL (not just a default) so that navigating away to
  // Insights/View and hitting Back lands on the tab the link came from,
  // rather than always resetting to Roster — the tab buttons below keep
  // this in sync via router.replace as the user clicks between tabs.
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = searchParams.get("tab");
    return isTab(fromUrl) ? fromUrl : "roster";
  });

  const selectTab = (key: Tab) => {
    setTab(key);
    router.replace(`/admin/teams/${slug}?tab=${key}`, { scroll: false });
  };

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { first_name: string | null; last_name: string | null }>>({});
  const [nssStatusByEmail, setNssStatusByEmail] = useState<Record<string, string>>({});

  const [snapshotScores, setSnapshotScores] = useState<TeamMemberScore[] | null>(null);
  // A ref, not state — setting it is a duplicate-fetch guard the effect
  // below reads synchronously, not something the UI renders from (that's
  // snapshotScores === null), so it doesn't need to trigger a re-render.
  const snapshotLoadingRef = useRef(false);

  const [sendState, setSendState] = useState<Record<string, SendState>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<string | null>(null);
  const [resyncError, setResyncError] = useState<string | null>(null);

  const [chartZoom, setChartZoom] = useState(1);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const chartDragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  const handleChartDragStart = (e: MouseEvent<HTMLDivElement>) => {
    const el = chartScrollRef.current;
    if (!el) return;
    chartDragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  };
  const handleChartDragMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = chartScrollRef.current;
    const drag = chartDragRef.current;
    if (!el || !drag) return;
    el.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    el.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
  };
  const stopChartDrag = () => {
    chartDragRef.current = null;
  };

  const orgForest = useMemo(() => {
    const reportsByEmail: Record<string, ReportEntry> = {};
    reports.forEach((r) => {
      if (r.user_email) reportsByEmail[r.user_email.toLowerCase()] = r;
    });
    return buildOrgForest(roster, reportsByEmail);
  }, [roster, reports]);

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
    // No status filter here — every submission for this team, so the
    // roster's NSS-status column can tell not-started apart from
    // in-progress apart from complete, not just "has a finished report."
    const { data: allSubmissions } = await supabase
      .from("nss_submissions")
      .select("id, respondent_name, user_email, user_id, status")
      .eq("team", slug);

    const statusByEmail: Record<string, string> = {};
    (allSubmissions ?? []).forEach((s) => {
      if (!s.user_email) return;
      const email = s.user_email.toLowerCase();
      const existingRank = NSS_STATUS_RANK[statusByEmail[email]] ?? -1;
      const thisRank = NSS_STATUS_RANK[s.status] ?? -1;
      if (thisRank >= existingRank) statusByEmail[email] = s.status;
    });
    setNssStatusByEmail(statusByEmail);

    const submissions = (allSubmissions ?? []).filter((s) => s.status === "completed" || s.status === "report_generated");

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
      submissions
        .map((s) => ({ ...s, completedAt: lastAnswered[s.id] ?? null }))
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    );

    const allProfiles = await listAllProfiles(supabase);
    setProfiles(Object.fromEntries(allProfiles.map((p) => [p.id, p])));
  };

  // Deliberately lazy (only runs once the Snapshot tab is first opened,
  // not on every workspace load) — it pulls every pairwise answer for
  // every completed submission on the team just to refit Bradley-Terry
  // client-side per person, which the Roster/Reports tabs have no need for.
  const loadSnapshot = async (completed: ReportEntry[]) => {
    snapshotLoadingRef.current = true;
    try {
      if (completed.length === 0) {
        setSnapshotScores([]);
        return;
      }
      const supabase = createClient();
      const ids = completed.map((r) => r.id);
      const allResponses = await fetchAllRows<{
        submission_id: string;
        chosen_clusters: ClusterKey[];
        rejected_clusters: ClusterKey[];
      }>((from, to) =>
        supabase
          .from("nss_responses")
          .select("submission_id, chosen_clusters, rejected_clusters")
          .in("submission_id", ids)
          .order("id")
          .range(from, to),
      );
      const bySubmission = new Map<string, BtResponse[]>();
      allResponses.forEach((r) => {
        const list = bySubmission.get(r.submission_id) ?? [];
        list.push({ chosen_clusters: r.chosen_clusters, rejected_clusters: r.rejected_clusters });
        bySubmission.set(r.submission_id, list);
      });

      const members = completed
        .map((r) => {
          const responses = bySubmission.get(r.id) ?? [];
          if (responses.length === 0) return null;
          const profile = profiles[r.user_id];
          const fullName = buildFullName(profile?.first_name, profile?.last_name, r.respondent_name);
          const [firstName, ...rest] = fullName.split(" ");
          return {
            userId: r.user_id,
            submissionId: r.id,
            firstName: firstName || fullName,
            lastName: rest.join(" "),
            responses,
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      setSnapshotScores(computeTeamMemberScores(members));
    } finally {
      snapshotLoadingRef.current = false;
    }
  };

  function nssStatusFor(email: string): NssStatus {
    const raw = nssStatusByEmail[email.toLowerCase()];
    if (raw === "completed" || raw === "report_generated") return "complete";
    if (raw === "in_progress") return "in_progress";
    return "not_started";
  }

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
        .select("id, name, slug, drive_spreadsheet_id, drive_folder_id")
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

  useEffect(() => {
    if (tab !== "snapshot" || loading || snapshotScores !== null || snapshotLoadingRef.current) return;
    loadSnapshot(reports.filter((r) => !!r.completedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loading, reports, snapshotScores]);

  const sendInvite = async (entry: RosterEntry) => {
    if (entry.invited_at) {
      const confirmed = window.confirm(
        `${entry.first_name} ${entry.last_name} was already invited on ${formatDate(entry.invited_at)}. Send the invite again?`,
      );
      if (!confirmed) return;
    }
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

  const handleRemove = async (entry: RosterEntry) => {
    const name = `${entry.first_name} ${entry.last_name}`;
    const confirmed = entry.invited_at
      ? window.confirm(
          `Remove ${name} from the roster? They were already invited, so this also permanently deletes their account (${entry.email}).`,
        )
      : window.confirm(`Remove ${name} from the roster?`);
    if (!confirmed || !team) return;

    setRemovingId(entry.id);
    try {
      const res = await fetch(`/api/nss/teams/${team.slug}/roster/${entry.id}`, { method: "DELETE" });
      if (res.ok) await loadRoster(team.id);
    } finally {
      setRemovingId(null);
    }
  };

  const handleResync = async () => {
    if (!team?.drive_spreadsheet_id) return;
    setResyncing(true);
    setResyncResult(null);
    setResyncError(null);
    try {
      const { grid, folderId } = await fetchRosterGridForSpreadsheet(team.drive_spreadsheet_id);
      const { rows, errors } = rosterRowsFromGrid(grid);
      if (errors.length > 0) {
        setResyncError(errors.join(" "));
        return;
      }
      const res = await fetch(`/api/nss/teams/${team.slug}/resync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, folderId }),
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
      // Picks up a freshly backfilled drive_folder_id too, not just the roster.
      const { data: refreshedTeam } = await createClient()
        .from("teams")
        .select("id, name, slug, drive_spreadsheet_id, drive_folder_id")
        .eq("slug", team.slug)
        .maybeSingle();
      if (refreshedTeam) setTeam(refreshedTeam);
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
                  onClick={() => selectTab(key)}
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
                        <th className="p-3 w-8" />
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manager</th>
                        <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invite Status</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody className="bg-card">
                      {roster.map((entry) => {
                        const state = sendState[entry.id] ?? "idle";
                        const nssStatus = nssStatusFor(entry.email);
                        return (
                          <tr key={entry.id} className="border-b border-border/30 last:border-0">
                            <td className="p-3">
                              {entry.invited_at && (
                                <span
                                  title={`NSS status: ${NSS_STATUS_LABEL[nssStatus]}`}
                                  className={`block w-2.5 h-2.5 rounded-full ${NSS_STATUS_COLOR[nssStatus]}`}
                                />
                              )}
                            </td>
                            <td className="p-3 text-sm text-foreground">
                              {entry.first_name} {entry.last_name}
                              {entry.missing_from_sheet && (
                                <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Not in sheet
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-sm text-muted-foreground break-all">{entry.email}</td>
                            <td className="p-3 text-sm text-muted-foreground break-all">{entry.manager_email}</td>
                            <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">
                              {entry.invited_at ? `Invited ${formatDate(entry.invited_at)}` : "Not invited"}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => sendInvite(entry)}
                                  disabled={state === "sending"}
                                  title={entry.invited_at ? "Resend invite" : "Send invite"}
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
                                  onClick={() => handleRemove(entry)}
                                  disabled={removingId === entry.id}
                                  title="Remove from roster"
                                  className="flex items-center justify-center h-8 w-8 shrink-0 text-muted-foreground border border-border/50 rounded-lg hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors disabled:opacity-50"
                                >
                                  {removingId === entry.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
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
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading text-sm font-semibold text-foreground">Reports</h2>
                  {roster.length > 0 && (
                    <div className="flex items-center gap-1 bg-card border border-border/50 rounded-lg p-1">
                      <button
                        onClick={() => setChartZoom((z) => Math.max(0.4, Math.round((z - 0.15) * 100) / 100))}
                        title="Zoom out"
                        className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setChartZoom(1)}
                        title="Reset zoom"
                        className="text-xs font-medium px-2 py-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                      >
                        {Math.round(chartZoom * 100)}%
                      </button>
                      <button
                        onClick={() => setChartZoom((z) => Math.min(1.5, Math.round((z + 0.15) * 100) / 100))}
                        title="Zoom in"
                        className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                {roster.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one on the roster yet.</p>
                ) : (
                  <div
                    ref={chartScrollRef}
                    onMouseDown={handleChartDragStart}
                    onMouseMove={handleChartDragMove}
                    onMouseUp={stopChartDrag}
                    onMouseLeave={stopChartDrag}
                    className="relative overflow-auto rounded-xl border border-border/50 bg-secondary/30 cursor-grab active:cursor-grabbing select-none"
                    style={{ height: "65vh" }}
                  >
                    <div
                      className="inline-block p-10 origin-top-left"
                      style={{ transform: `scale(${chartZoom})` }}
                    >
                      <ul className="flex gap-10">
                        {orgForest.map((root) => (
                          <li key={root.entry.id} className="flex flex-col items-center">
                            <OrgNodeRenderer node={root} profiles={profiles} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "snapshot" && (
              <div>
                {(() => {
                  const invitedCount = roster.filter((r) => !!r.invited_at).length;
                  return (
                    <p className="text-xs text-muted-foreground mb-4">
                      {reports.length} of {invitedCount} invited team member{invitedCount === 1 ? "" : "s"} have
                      completed the NSS so far.
                    </p>
                  );
                })()}

                {snapshotScores === null ? (
                  <div className="flex items-center justify-center min-h-[20vh]">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : snapshotScores.length === 0 ? (
                  <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
                    <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                    <p className="text-foreground text-sm font-medium mb-1">No completed surveys yet</p>
                    <p className="text-muted-foreground text-sm">
                      Once team members complete the NSS, their needs profile will appear here.
                    </p>
                  </div>
                ) : (
                  (() => {
                    const rowOrder = computeTeamRowOrder(snapshotScores);
                    return (
                      <div className="space-y-6">
                        <p className="text-sm text-muted-foreground max-w-2xl">
                          Darker colors and dots farther to the right indicate needs that emerged as stronger
                          priorities for that person when compared with their other needs. Lighter colors and dots
                          farther left indicate relatively lower priorities — not needs that are unimportant.
                          {snapshotScores.length === 1 &&
                            " With only one completed survey so far, this shows that person's own profile — team patterns will become clearer as more people complete the NSS."}
                        </p>

                        <div>
                          <h2 className="font-heading text-sm font-semibold text-foreground mb-2">
                            Team Needs Landscape
                          </h2>
                          <TeamNeedsHeatmap members={snapshotScores} rowOrder={rowOrder} />
                        </div>

                        <div>
                          <h2 className="font-heading text-sm font-semibold text-foreground mb-2">Needs Spectrum</h2>
                          <NeedsSpectrum members={snapshotScores} rowOrder={rowOrder} />
                        </div>

                        <p className="text-xs text-muted-foreground max-w-2xl">
                          This is an initial snapshot based on the choices people made between competing workplace
                          needs. Use it to start conversations, not to make definitive assumptions about anyone.
                        </p>
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
