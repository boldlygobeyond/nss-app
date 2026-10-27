"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
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
  ChevronDown,
  ChevronRight,
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
import { latestResponsePerQuestion } from "@/lib/nss/responseDedup";
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
  key: string;
  // null for a synthetic box standing in for a manager who isn't on the
  // roster themselves (see buildOrgForest below).
  entry: RosterEntry | null;
  externalManagerEmail: string | null;
  report: ReportEntry | null;
  children: OrgTreeNode[];
}

// Builds the manager hierarchy straight from the roster's own manager_email
// column — no separate "org chart" data to maintain. A roster row becomes
// a top-level box when its manager isn't anyone else on the roster (an
// external or not-yet-added manager). When two or more such rows share the
// same external manager, they're grouped under one synthetic box for that
// manager instead of showing as unrelated peers, so a big team still
// visibly rolls up to one person even though that person was never added
// to the roster themselves. A lone report to an unlisted manager stays a
// plain top-level box — nothing to group it with.
function buildOrgForest(roster: RosterEntry[], reportsByEmail: Record<string, ReportEntry>): OrgTreeNode[] {
  const byEmail = new Map(roster.map((r) => [r.email.toLowerCase(), r]));
  const childrenOf = new Map<string, RosterEntry[]>();
  const hasInternalParent = new Set<string>();

  roster.forEach((r) => {
    const email = r.email.toLowerCase();
    const managerEmail = r.manager_email?.trim().toLowerCase();
    if (managerEmail && managerEmail !== email && byEmail.has(managerEmail)) {
      hasInternalParent.add(email);
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
      key: entry.id,
      entry,
      externalManagerEmail: null,
      report: reportsByEmail[entry.email.toLowerCase()] ?? null,
      children: kids.map(buildNode),
    };
  }

  const topLevelNodes: OrgTreeNode[] = roster
    .filter((r) => !hasInternalParent.has(r.email.toLowerCase()))
    .sort(byFirstName)
    .map(buildNode);

  // A pure manager cycle leaves every row in it without a "no manager
  // found" root to hang off of — surface those as extra top-level boxes
  // instead of silently dropping someone's report from the chart.
  roster
    .filter((r) => !visited.has(r.email.toLowerCase()))
    .sort(byFirstName)
    .forEach((r) => topLevelNodes.push(buildNode(r)));

  const externalGroups = new Map<string, OrgTreeNode[]>();
  const forest: OrgTreeNode[] = [];
  topLevelNodes.forEach((node) => {
    const managerEmail = node.entry?.manager_email?.trim().toLowerCase();
    if (!managerEmail || managerEmail === node.entry?.email.toLowerCase()) {
      forest.push(node);
      return;
    }
    const list = externalGroups.get(managerEmail) ?? [];
    list.push(node);
    externalGroups.set(managerEmail, list);
  });

  externalGroups.forEach((members, managerEmail) => {
    if (members.length < 2) {
      forest.push(...members);
      return;
    }
    forest.push({
      key: `external:${managerEmail}`,
      entry: null,
      externalManagerEmail: managerEmail,
      report: null,
      children: members.sort((a, b) => a.entry!.first_name.localeCompare(b.entry!.first_name)),
    });
  });

  return forest.sort((a, b) =>
    (a.entry?.first_name ?? a.externalManagerEmail ?? "").localeCompare(
      b.entry?.first_name ?? b.externalManagerEmail ?? "",
    ),
  );
}

function countDescendants(node: OrgTreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

function OrgBox({
  node,
  profiles,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
}: {
  node: OrgTreeNode;
  profiles: Record<string, { first_name: string | null; last_name: string | null }>;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const { entry, report } = node;

  // Straddles the box's bottom edge so it reads as part of the connector
  // line rather than part of the card — only rendered when there's
  // actually a branch underneath to expand or collapse.
  const toggleButton = hasChildren && (
    <button
      onClick={onToggleCollapse}
      title={isCollapsed ? "Expand this branch" : "Collapse this branch"}
      className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
    >
      {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
    </button>
  );

  if (!entry) {
    return (
      <div className="relative bg-secondary/40 border border-dashed border-border rounded-xl p-3 w-44 text-center shrink-0">
        <p className="text-sm font-medium text-foreground truncate" title={node.externalManagerEmail ?? undefined}>
          {node.externalManagerEmail}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">Manager (not on roster)</p>
        {toggleButton}
      </div>
    );
  }

  const fullName = report
    ? buildFullName(profiles[report.user_id]?.first_name, profiles[report.user_id]?.last_name, report.respondent_name)
    : `${entry.first_name} ${entry.last_name}`.trim();

  return (
    <div className="relative bg-card border border-border/50 rounded-xl p-3 w-44 text-center shadow-sm shrink-0">
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
      {toggleButton}
    </div>
  );
}

// Classic two-tier CSS connector tree: the <ul> draws one trunk line down
// from the parent box, then each <li> draws an elbow (a horizontal half-
// segment joining it to its neighbor, plus a vertical drop into its own
// child box) via ::before/::after, trimmed at the first/last/only child so
// the bus line never overshoots the outermost children. This makes each
// line trace a specific reports-to relationship instead of one shared
// divider standing in for "all of these roll up to the box above".
// Children render in a single non-wrapping row (the admin collapses
// branches to manage width instead
// of the row wrapping, which would otherwise sever the bus line); the
// Reports tab's outer container scrolls horizontally if a row is wider
// than the viewport.
function OrgNodeRenderer({
  node,
  profiles,
  collapsed,
  onToggle,
}: {
  node: OrgTreeNode;
  profiles: Record<string, { first_name: string | null; last_name: string | null }>;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(node.key);

  return (
    <div className="flex flex-col items-center">
      <OrgBox
        node={node}
        profiles={profiles}
        hasChildren={hasChildren}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => onToggle(node.key)}
      />
      {isCollapsed && (
        <p className="mt-4 text-[11px] text-muted-foreground whitespace-nowrap">
          {countDescendants(node)} hidden — click to expand
        </p>
      )}
      {hasChildren && !isCollapsed && (
        <ul
          className="list-none relative flex justify-center pt-6 before:content-[''] before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:w-px before:h-6 before:bg-border"
        >
          {node.children.map((child) => (
            <li
              key={child.key}
              className="relative px-3 pt-6 before:content-[''] before:absolute before:top-0 before:right-1/2 before:w-1/2 before:h-6 before:border-t before:border-border after:content-[''] after:absolute after:top-0 after:left-1/2 after:w-1/2 after:h-6 after:border-t after:border-l after:border-border first:before:border-t-0 last:after:border-t-0 last:after:border-l-0 last:before:border-r last:before:border-border only:before:hidden only:after:hidden only:pt-0"
            >
              <OrgNodeRenderer node={child} profiles={profiles} collapsed={collapsed} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      )}
    </div>
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

  const orgForest = useMemo(() => {
    const reportsByEmail: Record<string, ReportEntry> = {};
    reports.forEach((r) => {
      if (r.user_email) reportsByEmail[r.user_email.toLowerCase()] = r;
    });
    return buildOrgForest(roster, reportsByEmail);
  }, [roster, reports]);

  // Which org-chart branches are collapsed, keyed by OrgTreeNode.key.
  // Everything starts expanded; the admin collapses branches themselves to
  // declutter a wide/deep chart rather than the chart auto-collapsing on
  // them.
  const [collapsedOrgNodes, setCollapsedOrgNodes] = useState<Set<string>>(new Set());
  const toggleOrgNode = (key: string) => {
    setCollapsedOrgNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const loadRoster = async (teamId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("team_roster")
      .select("id, first_name, last_name, email, manager_email, invited_at, missing_from_sheet")
      .eq("team_id", teamId)
      .order("last_name");
    setRoster(data ?? []);
  };

  // Shared by loadReports (full load) and pollNssStatus (the cheap
  // recurring one below) so the "most advanced status wins" rule can't
  // drift between the two call sites.
  const mergeStatusByEmail = (rows: { user_email: string | null; status: string }[]): Record<string, string> => {
    const statusByEmail: Record<string, string> = {};
    rows.forEach((s) => {
      if (!s.user_email) return;
      const email = s.user_email.toLowerCase();
      const existingRank = NSS_STATUS_RANK[statusByEmail[email]] ?? -1;
      const thisRank = NSS_STATUS_RANK[s.status] ?? -1;
      if (thisRank >= existingRank) statusByEmail[email] = s.status;
    });
    return statusByEmail;
  };

  // Polled every few seconds (see the effect below) so the roster dot
  // moves from in-progress to complete on its own while someone's
  // actually taking the survey, without the admin reloading the page.
  // Deliberately NOT the same query loadReports runs — that one also
  // scans every nss_responses row platform-wide to compute each report's
  // completedAt date for the Reports tab, which doesn't need to happen
  // every few seconds just to keep a status dot current.
  const pollNssStatus = async () => {
    const supabase = createClient();
    const { data: allSubmissions } = await supabase
      .from("nss_submissions")
      .select("user_email, status")
      .eq("team", slug);
    setNssStatusByEmail(mergeStatusByEmail(allSubmissions ?? []));
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

    setNssStatusByEmail(mergeStatusByEmail(allSubmissions ?? []));

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
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
        // One entry per person — a retake should replace their earlier
        // submission everywhere this feeds (org chart, team snapshot), not
        // show up alongside it. The array is already sorted most-recent
        // first, so keeping each user_id's first occurrence keeps their
        // latest completed submission.
        .filter((r, i, arr) => arr.findIndex((x) => x.user_id === r.user_id) === i),
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
        question_id: number;
        chosen_clusters: ClusterKey[];
        rejected_clusters: ClusterKey[];
        answered_at: string;
      }>((from, to) =>
        supabase
          .from("nss_responses")
          .select("submission_id, question_id, chosen_clusters, rejected_clusters, answered_at")
          .in("submission_id", ids)
          .order("id")
          .range(from, to),
      );
      const rawBySubmission = new Map<string, typeof allResponses>();
      allResponses.forEach((r) => {
        const list = rawBySubmission.get(r.submission_id) ?? [];
        list.push(r);
        rawBySubmission.set(r.submission_id, list);
      });
      // Deduplicated per submission (a question can have more than one
      // stored row for the same submission — see
      // NSS_Back_Navigation_And_Duplicate_Fix.md) before anyone's responses feed into
      // team scoring, same rule every other scoring consumer uses.
      const bySubmission = new Map<string, BtResponse[]>();
      rawBySubmission.forEach((rows, submissionId) => {
        bySubmission.set(
          submissionId,
          latestResponsePerQuestion(rows).map((r) => ({
            chosen_clusters: r.chosen_clusters,
            rejected_clusters: r.rejected_clusters,
          })),
        );
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

  // Keeps the roster's status dot live while this page is open — a
  // respondent finishing the survey in another tab/device flips their dot
  // from in-progress to complete here on its own, no reload needed.
  useEffect(() => {
    if (loading || !team) return;
    const interval = setInterval(pollNssStatus, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, team, slug]);

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
                <h2 className="font-heading text-sm font-semibold text-foreground mb-3">Reports</h2>
                {roster.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one on the roster yet.</p>
                ) : (
                  <div className="rounded-xl border border-border/50 bg-secondary/30 p-6 overflow-x-auto">
                    {/* min-w-max keeps this shrink-to-fit instead of stretching to the
                        scroll container's width — without it, justify-center splits any
                        overflow evenly across both edges, and a scroll container only
                        ever exposes the overflow on one edge, so the other half becomes
                        permanently unreachable and invisible with no scrollbar to find it. */}
                    <div className="flex justify-center gap-x-10 gap-y-8 min-w-max">
                      {orgForest.map((root) => (
                        <OrgNodeRenderer
                          key={root.key}
                          node={root}
                          profiles={profiles}
                          collapsed={collapsedOrgNodes}
                          onToggle={toggleOrgNode}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "snapshot" && (
              <div>
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
                        <div>
                          <h2 className="font-heading text-sm font-semibold text-foreground mb-3">
                            Our Team&apos;s Needs Landscape
                          </h2>
                          <TeamNeedsHeatmap members={snapshotScores} rowOrder={rowOrder} />
                        </div>

                        <hr className="border-border/50" />

                        <div>
                          <h2 className="font-heading text-sm font-semibold text-foreground mb-3">
                            Our Team&apos;s Needs Profile
                          </h2>
                          <NeedsSpectrum members={snapshotScores} rowOrder={rowOrder} />
                        </div>
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
