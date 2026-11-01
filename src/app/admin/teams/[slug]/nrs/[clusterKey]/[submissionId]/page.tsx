"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nrs/clusters";
import { nrsRatingByValue } from "@/lib/nrs/ratingScale";
import GlobalHeader from "@/components/GlobalHeader";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ScenarioRow {
  questionId: number;
  order: number;
  needLabel: string;
  scenarioText: string;
  rating: number | null;
}

interface DrillDownData {
  firstName: string;
  lastName: string;
  resonanceScore: number | null;
  completedAt: string | null;
  scenarios: ScenarioRow[];
}

// Modeled on /admin/reports/[id]/insights's admin-gate/layout pattern, at
// a much smaller scale — no integrity panel, cluster matrix, or
// confidence-over-time chart, since none of that applies to a single
// 10-scenario NRS scan. Only authorized BGB admins ever reach this
// (client-side gate, same as every other admin page here); the
// underlying nrs_submissions/nrs_responses rows are also admin-only at
// the RLS level regardless.
export default function NrsDrillDownPage({
  params,
}: {
  params: Promise<{ slug: string; clusterKey: string; submissionId: string }>;
}) {
  const { slug, clusterKey, submissionId } = use(params);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<DrillDownData | null>(null);

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
      const profile = await getMyProfile(supabase, user.id);
      if (profile?.role !== "admin") {
        setLoading(false);
        return;
      }
      setAuthorized(true);

      const { data: submission } = await supabase
        .from("nrs_submissions")
        .select("resonance_score, completed_at, team_roster(first_name, last_name, team_id)")
        .eq("id", submissionId)
        .maybeSingle();

      if (submission) {
        const roster = Array.isArray(submission.team_roster) ? submission.team_roster[0] : submission.team_roster;

        // The 10 scenarios this specific team was asked for this cluster —
        // never "all scenarios in this cluster" (a cluster can hold up to
        // 30; only the team's own saved selection was actually presented).
        const { data: selectionRow } = roster
          ? await supabase
              .from("nrs_team_cluster_scenarios")
              .select("question_ids")
              .eq("team_id", roster.team_id)
              .eq("cluster_key", clusterKey)
              .maybeSingle()
          : { data: null };
        const questionIds: number[] = selectionRow?.question_ids ?? [];

        const [{ data: questions }, { data: responses }] = await Promise.all([
          questionIds.length
            ? supabase
                .from("nrs_questions")
                .select("id, display_order, need_label, scenario_text")
                .in("id", questionIds)
                .order("display_order")
            : Promise.resolve({ data: [] }),
          supabase.from("nrs_responses").select("question_id, rating").eq("submission_id", submissionId),
        ]);

        const ratingByQuestion = new Map((responses ?? []).map((r) => [r.question_id, r.rating as number]));
        setData({
          firstName: roster?.first_name ?? "",
          lastName: roster?.last_name ?? "",
          resonanceScore: submission.resonance_score,
          completedAt: submission.completed_at,
          // Sequential 1-10, matching what the participant actually saw —
          // not the raw display_order, which is now a position within the
          // cluster's full 30-scenario bank, not this team's 10.
          scenarios: (questions ?? []).map((q, i) => ({
            questionId: q.id,
            order: i + 1,
            needLabel: q.need_label,
            scenarioText: q.scenario_text,
            rating: ratingByQuestion.get(q.id) ?? null,
          })),
        });
      }
      setLoading(false);
    };
    load();
  }, [submissionId, clusterKey]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GlobalHeader />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GlobalHeader />
        <div className="max-w-2xl mx-auto px-6 py-12 w-full">
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GlobalHeader />
        <div className="max-w-2xl mx-auto px-6 py-12 w-full">
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <p className="text-muted-foreground text-sm">No response found for this link.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-2xl mx-auto px-6 py-12 w-full">
        <Link
          href={`/admin/teams/${slug}?tab=nrs`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">
          {data.firstName} {data.lastName}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {CLUSTER_LABELS[clusterKey as ClusterKey] ?? clusterKey}
          {data.completedAt && <> · completed {formatDate(data.completedAt)}</>}
        </p>

        <div className="bg-card border border-border/50 rounded-2xl p-6 mb-8 text-center">
          <p className="text-4xl font-semibold text-foreground tabular-nums">
            {data.resonanceScore != null ? data.resonanceScore.toFixed(1) : "—"}
            <span className="text-lg text-muted-foreground"> / 5</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">resonance score</p>
        </div>

        <h2 className="font-heading text-sm font-semibold text-foreground mb-3">All scenarios</h2>
        <div className="space-y-3">
          {data.scenarios.map((s) => {
            const rating = s.rating != null ? nrsRatingByValue(s.rating) : null;
            return (
              <div key={s.questionId} className="bg-card border border-border/50 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-2">
                  Scenario {s.order} · <span className="font-medium">{s.needLabel}</span>
                </p>
                <p className="text-sm text-foreground leading-relaxed mb-3">{s.scenarioText}</p>
                {rating ? (
                  <p className="text-sm font-medium text-foreground">
                    {rating.value} · {rating.label}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No response recorded</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
