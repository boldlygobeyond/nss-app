import { CHART_ORDER, CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import type { ClusterScore } from "@/lib/nss/surveyEngine";

// Fixed cluster order (see CHART_ORDER) so this chart is directly comparable
// across users and over time — no text classification labels, just the
// calculated percentage and a position indicator on the track.
export default function NeedsChart({ scores }: { scores: Record<ClusterKey, ClusterScore> | null }) {
  if (!scores) return null;

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-6">
        Favorability score across your 7 need clusters
      </p>
      <div className="space-y-4">
        {CHART_ORDER.map((cluster) => {
          const pct = Math.round((scores[cluster]?.winRate ?? 0.5) * 100);
          return (
            <div key={cluster} className="flex items-center gap-4">
              <span className="w-44 shrink-0 text-sm font-medium text-foreground">{CLUSTER_LABELS[cluster]}</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-secondary">
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-primary shadow-sm print:shadow-none"
                  style={{ left: `${pct}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-sm font-semibold text-foreground">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
