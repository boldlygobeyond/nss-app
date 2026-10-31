import type { ReactNode } from "react";
import { ArrowUpRight, Grid2x2 } from "lucide-react";
import { CHART_ORDER, CLUSTER_LABELS, CLUSTER_COLORS, type ClusterKey } from "@/lib/nss/clusters";
import type { ClusterScore } from "@/lib/nss/surveyEngine";

function ClusterPill({ cluster }: { cluster: ClusterKey }) {
  return (
    // bg-card/text-card-foreground, not bg-white/text-[hex]: those are the
    // paired tokens the rest of the app uses for "a surface sitting on a
    // tinted background," so this pill is guaranteed readable in both
    // themes without a hardcoded color.
    <span className="inline-flex items-center gap-2 bg-card text-card-foreground rounded-full px-3.5 py-1.5 text-sm font-semibold">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CLUSTER_COLORS[cluster] }} />
      {CLUSTER_LABELS[cluster]}
    </span>
  );
}

function SnapshotCard({
  tint,
  iconBg,
  iconShape,
  icon,
  title,
  clusters,
}: {
  // Low-opacity tints of theme tokens (e.g. bg-primary/10), matching the
  // "Key Pattern" callout's bg-accent/5 in ReportView.tsx — a tint over the
  // page's own background, not a fixed opaque hex, so it reads as a subtle
  // light wash in light mode and a subtle dark wash in dark mode.
  tint: string;
  iconBg: string;
  iconShape: "circle" | "square";
  icon: ReactNode;
  title: string;
  clusters: ClusterKey[];
}) {
  return (
    <div className={`rounded-2xl p-5 print:break-inside-avoid ${tint}`}>
      <div className="flex items-center gap-3.5 mb-3.5">
        <div
          className={`w-9 h-9 flex items-center justify-center shrink-0 ${iconShape === "circle" ? "rounded-full" : "rounded-xl"} ${iconBg}`}
        >
          {icon}
        </div>
        <p className="font-heading text-base font-bold text-foreground">{title}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {clusters.map((cluster) => (
          <ClusterPill key={cluster} cluster={cluster} />
        ))}
      </div>
    </div>
  );
}

export default function LeadingNeedsSnapshot({ scores }: { scores: Record<ClusterKey, ClusterScore> | null }) {
  if (!scores) return null;

  // Descending by the existing Bradley-Terry favorability score — stored
  // under ClusterScore.winRate (a legacy field name; SurveyClient's
  // finishSurvey overwrites it with real BT favorability once the BT
  // engine is live, which it is for this app). Sorting CHART_ORDER (not
  // CLUSTERS or an unsorted object) keeps tie-breaking deterministic and
  // matches every other ranked view in the app.
  const ranked = [...CHART_ORDER].sort((a, b) => (scores[b]?.winRate ?? 0.5) - (scores[a]?.winRate ?? 0.5));
  const leading = ranked.slice(0, 3);
  const other = ranked.slice(3);

  return (
    <div className="flex flex-col gap-4">
      <SnapshotCard
        tint="bg-primary/10"
        iconBg="bg-primary"
        iconShape="circle"
        icon={<ArrowUpRight className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />}
        title="Your Leading Needs"
        clusters={leading}
      />
      <p className="text-muted-foreground leading-relaxed">
        Your other needs are important, too. They just didn&apos;t emerge as strongly in your choices.
      </p>
      <SnapshotCard
        tint="bg-accent/10"
        iconBg="bg-accent/20"
        iconShape="square"
        icon={<Grid2x2 className="w-4 h-4 text-accent" strokeWidth={2.5} />}
        title="Your Other Needs"
        clusters={other}
      />
    </div>
  );
}
