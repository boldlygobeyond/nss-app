"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CLUSTERS, CLUSTER_LABELS, type ClusterKey } from "@/lib/nrs/clusters";
import { favorabilityToTeal, heatmapLegendGradientCss } from "@/lib/nss/teamScores";

const SCORE_LABEL_COLUMN = "6rem";
const MIN_PERSON_COLUMN = "4.5rem";

type NrsSubmissionStatus = "invited" | "in_progress" | "completed";

const STATUS_COLOR: Record<NrsSubmissionStatus, string> = {
  invited: "bg-muted-foreground/40",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
};
const STATUS_LABEL: Record<NrsSubmissionStatus, string> = {
  invited: "Invited",
  in_progress: "In progress",
  completed: "Completed",
};

// Reuses NSS's own 0-1 favorability color scale (same visual language as
// the NSS Team Snapshot heatmap) rather than inventing a second one — a
// 1-5 rating just gets normalized onto that same 0-1 range first.
function ratingToColor(rating: number): string {
  return favorabilityToTeal((rating - 1) / 4);
}

interface EmployeeRow {
  rosterId: string;
  displayName: string;
  status: NrsSubmissionStatus | null;
  submissionId: string | null;
  score: number | null;
}

interface QuestionRow {
  id: number;
  order: number;
  scenarioText: string;
}

interface SnapshotData {
  employees: EmployeeRow[];
  questions: QuestionRow[];
  // responses[questionId][rosterId] -> rating, only present once answered
  responses: Record<number, Record<string, number>>;
}

// First name alone, unless two people on this team's roster share one —
// then just those people get a last initial appended. Small, local
// equivalent of NSS's heatmapDisplayNames (src/lib/nss/teamScores.ts),
// which is typed for its own TeamMemberScore shape and not reused here to
// keep NRS's modules independent, per this feature's existing pattern.
function displayNames(people: { rosterId: string; firstName: string; lastName: string }[]): Record<string, string> {
  const counts = new Map<string, number>();
  people.forEach((p) => counts.set(p.firstName, (counts.get(p.firstName) ?? 0) + 1));
  const result: Record<string, string> = {};
  people.forEach((p) => {
    const needsDisambiguation = (counts.get(p.firstName) ?? 0) > 1;
    result[p.rosterId] = needsDisambiguation && p.lastName ? `${p.firstName} ${p.lastName[0]}.` : p.firstName;
  });
  return result;
}

export default function NrsTeamSnapshot({ teamId }: { teamId: string }) {
  const [configuredClusters, setConfiguredClusters] = useState<Set<ClusterKey> | null>(null);
  const [clusterKey, setClusterKey] = useState<ClusterKey>("Stability");
  const [data, setData] = useState<SnapshotData | null>(null);
  // Pure visual hover cue on the score heatmap — mirrors TeamNeedsHeatmap's
  // own hover highlight (src/components/teams/TeamNeedsHeatmap.tsx), just
  // keyed on person alone since there's only the one row here.
  const [hoveredRosterId, setHoveredRosterId] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setData(null);
      const supabase = createClient();
      const [{ data: roster }, { data: submissions }, { data: questions }] = await Promise.all([
        supabase.from("team_roster").select("id, first_name, last_name").eq("team_id", teamId).order("first_name"),
        supabase
          .from("nrs_submissions")
          .select("id, roster_id, status, resonance_score")
          .eq("cluster_key", clusterKey),
        supabase
          .from("nrs_questions")
          .select("id, display_order, scenario_text")
          .eq("cluster_key", clusterKey)
          .order("display_order"),
      ]);
      if (cancelled) return;

      const submissionByRosterId = new Map((submissions ?? []).map((s) => [s.roster_id, s]));
      const submissionIds = (submissions ?? []).map((s) => s.id);

      const { data: responses } = submissionIds.length
        ? await supabase.from("nrs_responses").select("submission_id, question_id, rating").in("submission_id", submissionIds)
        : { data: [] };
      if (cancelled) return;

      const rosterIdBySubmissionId = new Map((submissions ?? []).map((s) => [s.id, s.roster_id]));
      const responseMap: Record<number, Record<string, number>> = {};
      (responses ?? []).forEach((r) => {
        const rosterId = rosterIdBySubmissionId.get(r.submission_id);
        if (!rosterId) return;
        (responseMap[r.question_id] ??= {})[rosterId] = r.rating;
      });

      const names = displayNames((roster ?? []).map((r) => ({ rosterId: r.id, firstName: r.first_name, lastName: r.last_name })));
      const employees: EmployeeRow[] = (roster ?? []).map((r) => {
        const s = submissionByRosterId.get(r.id);
        return {
          rosterId: r.id,
          displayName: names[r.id],
          status: (s?.status as NrsSubmissionStatus) ?? null,
          submissionId: s?.id ?? null,
          score: s?.resonance_score ?? null,
        };
      });

      setData({
        employees,
        questions: (questions ?? []).map((q) => ({ id: q.id, order: q.display_order, scenarioText: q.scenario_text })),
        responses: responseMap,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, clusterKey]);

  const isConfigured = configuredClusters?.has(clusterKey) ?? false;
  // Only people with at least an invite show up as matrix columns — a
  // never-invited roster row would just be every cell blank.
  const participatingEmployees = (data?.employees ?? []).filter((e) => e.status !== null);

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <label htmlFor="nrs-snapshot-cluster" className="text-xs font-medium text-muted-foreground">
          Cluster
        </label>
        <select
          id="nrs-snapshot-cluster"
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

      {!isConfigured ? (
        <div className="bg-secondary/40 border border-dashed border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {CLUSTER_LABELS[clusterKey]} doesn&apos;t have any scenarios configured yet.
          </p>
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.employees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one on the roster yet.</p>
      ) : (
        <div className="space-y-8">
          <div>
            <h2 className="font-heading text-sm font-semibold text-foreground mb-3">Scores by person</h2>
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <div
                role="table"
                className="grid"
                style={{
                  gridTemplateColumns: `${SCORE_LABEL_COLUMN} repeat(${data.employees.length}, minmax(${MIN_PERSON_COLUMN}, 1fr))`,
                }}
                onMouseLeave={() => setHoveredRosterId(null)}
              >
                <div role="row" className="contents">
                  <div role="columnheader" className="sticky left-0 z-10 bg-card" />
                  {data.employees.map((e) => (
                    <div
                      key={e.rosterId}
                      role="columnheader"
                      className={`p-2 text-xs font-semibold text-center whitespace-nowrap truncate transition-colors ${
                        hoveredRosterId === e.rosterId ? "text-foreground bg-secondary/60" : "text-muted-foreground"
                      }`}
                    >
                      {e.displayName}
                    </div>
                  ))}
                </div>
                <div role="row" className="contents">
                  <div
                    role="rowheader"
                    className={`sticky left-0 z-10 bg-card p-2 pr-4 text-left text-xs font-medium whitespace-nowrap border-t border-border/30 flex items-center transition-colors ${
                      hoveredRosterId ? "text-foreground bg-secondary/60" : "text-foreground"
                    }`}
                  >
                    Score
                  </div>
                  {data.employees.map((e) => (
                    <div
                      key={e.rosterId}
                      role="cell"
                      className="p-1.5 border-t border-border/30 flex items-center justify-center"
                    >
                      {e.score != null ? (
                        <div
                          aria-label={`${e.displayName} — ${e.score.toFixed(1)}`}
                          onMouseEnter={() => setHoveredRosterId(e.rosterId)}
                          style={{ backgroundColor: ratingToColor(e.score), color: e.score >= 3.5 ? "#ffffff" : "#0f1729" }}
                          className="w-full h-10 rounded-md border border-border/40 flex items-center justify-center text-sm font-semibold tabular-nums"
                        >
                          {e.score.toFixed(1)}
                        </div>
                      ) : (
                        <div
                          onMouseEnter={() => setHoveredRosterId(e.rosterId)}
                          className="w-full h-10 rounded-md border border-dashed border-border/40 flex items-center justify-center gap-1"
                          title={e.status ? STATUS_LABEL[e.status] : "Not invited"}
                        >
                          {e.status && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[e.status]}`} />}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-2.5 max-w-md mx-auto">
              <div className="h-2.5 rounded-full" style={{ background: heatmapLegendGradientCss() }} />
              <div className="flex items-center justify-between mt-1.5 text-sm text-muted-foreground">
                <span>Lower score</span>
                <span>Higher score</span>
              </div>
            </div>
          </div>

          {participatingEmployees.length > 0 && (
            <div>
              <h2 className="font-heading text-sm font-semibold text-foreground mb-3">Responses by question</h2>
              <div className="overflow-x-auto rounded-xl border border-border/50">
                <table className="w-full border-collapse">
                  <thead className="bg-secondary">
                    <tr>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide sticky left-0 bg-secondary min-w-[16rem]">
                        Scenario
                      </th>
                      {participatingEmployees.map((e) => (
                        <th
                          key={e.rosterId}
                          className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                        >
                          {e.displayName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-card">
                    {data.questions.map((q) => (
                      <tr key={q.id} className="border-t border-border/30">
                        <td className="p-3 text-sm text-foreground sticky left-0 bg-card">
                          <span className="text-xs text-muted-foreground mr-1.5">{q.order}.</span>
                          {q.scenarioText}
                        </td>
                        {participatingEmployees.map((e) => {
                          const rating = data.responses[q.id]?.[e.rosterId];
                          return (
                            <td key={e.rosterId} className="p-1.5 text-center">
                              {rating != null ? (
                                <span
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-semibold tabular-nums"
                                  style={{ backgroundColor: ratingToColor(rating), color: rating >= 3.5 ? "#ffffff" : "#0f1729" }}
                                >
                                  {rating}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
