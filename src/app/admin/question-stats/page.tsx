"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import GlobalHeader from "@/components/GlobalHeader";

// Flagged purely for this page's own context, not the delivery logic —
// these two pairs were last-resort-only until 2026-10-16, when that
// policy was removed specifically to see how real respondents react to
// the actual questions. Worth watching closely here while that plays out.
const RECENTLY_REINSTATED_PAIRS = new Set(["Belonging|Connections", "Belonging|Stability"]);

interface QuestionRow {
  id: number;
  clusterA: ClusterKey;
  clusterB: ClusterKey;
  standardQuestion: string;
  presented: number;
  answered: number;
  itDepends: number;
  skipped: number;
}

type SortKey = "id" | "presented" | "itDepends" | "skipped" | "attention";

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function pct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

export default function QuestionStatsPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

      const [{ data: questions }, { data: submissions }, { data: responses }] = await Promise.all([
        supabase
          .from("nss_questions")
          .select("id, cluster_a, cluster_b, standard_question")
          .gte("id", 51),
        // question_sequence only ever contains ids that were genuinely
        // presented — it grows one entry at a time as the real app shows
        // each question, so an in-progress submission's sequence is just
        // as trustworthy as a completed one's for "was this presented."
        supabase.from("nss_submissions").select("question_sequence").not("question_sequence", "is", null),
        supabase.from("nss_responses").select("question_id, is_sharpened"),
      ]);

      const presentedCount = new Map<number, number>();
      (submissions ?? []).forEach((s) => {
        (s.question_sequence as number[] | null)?.forEach((qid) => {
          presentedCount.set(qid, (presentedCount.get(qid) ?? 0) + 1);
        });
      });

      const answeredCount = new Map<number, number>();
      const itDependsCount = new Map<number, number>();
      (responses ?? []).forEach((r) => {
        answeredCount.set(r.question_id, (answeredCount.get(r.question_id) ?? 0) + 1);
        if (r.is_sharpened) itDependsCount.set(r.question_id, (itDependsCount.get(r.question_id) ?? 0) + 1);
      });

      const built: QuestionRow[] = (questions ?? []).map((q) => {
        const presented = presentedCount.get(q.id) ?? 0;
        const answered = answeredCount.get(q.id) ?? 0;
        return {
          id: q.id,
          clusterA: q.cluster_a as ClusterKey,
          clusterB: q.cluster_b as ClusterKey,
          standardQuestion: q.standard_question,
          presented,
          answered,
          itDepends: itDependsCount.get(q.id) ?? 0,
          // A presented question with no matching response row was
          // skipped — question_sequence and nss_responses are the two
          // sources of truth here, same logic as scripts/audit-survey-path.ts.
          skipped: Math.max(0, presented - answered),
        };
      });

      setRows(built);
      setLoading(false);
    };
    load();
  }, []);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          presented: acc.presented + r.presented,
          itDepends: acc.itDepends + r.itDepends,
          skipped: acc.skipped + r.skipped,
        }),
        { presented: 0, itDepends: 0, skipped: 0 },
      ),
    [rows],
  );

  const sorted = useMemo(() => {
    const withAttention = rows.map((r) => ({ ...r, attention: r.itDepends + r.skipped }));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...withAttention].sort((a, b) => dir * (a[sortKey] - b[sortKey]));
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    col !== sortKey ? (
      <ArrowUpDown className="w-3 h-3 opacity-30" />
    ) : sortDir === "desc" ? (
      <ArrowDown className="w-3 h-3" />
    ) : (
      <ArrowUp className="w-3 h-3" />
    );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-4xl mx-auto px-6 py-12 w-full">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">Question Stats</h1>
        <p className="text-sm text-muted-foreground mb-8">
          How often each question gets &quot;it depends&quot; or gets skipped outright, across every respondent.
        </p>

        {loading ? (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authorized ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-px bg-border/50 border border-border/50 rounded-xl overflow-hidden mb-6">
              <div className="bg-card p-4">
                <p className="text-2xl font-semibold text-foreground tabular-nums">{totals.presented}</p>
                <p className="text-xs text-muted-foreground mt-1">times presented</p>
              </div>
              <div className="bg-card p-4">
                <p className="text-2xl font-semibold text-foreground tabular-nums">{totals.itDepends}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  &quot;it depends&quot; ({pct(totals.itDepends, totals.presented)})
                </p>
              </div>
              <div className="bg-card p-4">
                <p className="text-2xl font-semibold text-foreground tabular-nums">{totals.skipped}</p>
                <p className="text-xs text-muted-foreground mt-1">skipped ({pct(totals.skipped, totals.presented)})</p>
              </div>
            </div>

            <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> recently reinstated pair (watch closely)
              </span>
            </div>

            <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort("id")} className="inline-flex items-center gap-1 hover:text-foreground">
                        # <SortIcon col="id" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Question</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        onClick={() => toggleSort("presented")}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        Presented <SortIcon col="presented" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        onClick={() => toggleSort("itDepends")}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        It depends <SortIcon col="itDepends" />
                      </button>
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      <button
                        onClick={() => toggleSort("skipped")}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        Skipped <SortIcon col="skipped" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const flagged = RECENTLY_REINSTATED_PAIRS.has(pairKey(r.clusterA, r.clusterB));
                    return (
                      <tr key={r.id} className="border-b border-border/30 last:border-0 align-top">
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">#{r.id}</td>
                        <td className="px-4 py-3">
                          <p className="text-foreground">{r.standardQuestion}</p>
                          <p className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                            {flagged && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                            {CLUSTER_LABELS[r.clusterA]} vs {CLUSTER_LABELS[r.clusterB]}
                          </p>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground">{r.presented}</td>
                        <td className="px-4 py-3 tabular-nums text-foreground">
                          {r.itDepends}{" "}
                          <span className="text-xs text-muted-foreground">({pct(r.itDepends, r.presented)})</span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground">
                          {r.skipped}{" "}
                          <span className="text-xs text-muted-foreground">({pct(r.skipped, r.presented)})</span>
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
    </div>
  );
}
