import type { ReactNode } from "react";
import { ArrowUpRight, Grid2x2 } from "lucide-react";
import { CHART_ORDER, CLUSTER_LABELS, CLUSTER_COLORS, type ClusterKey } from "@/lib/nss/clusters";
import type { ClusterScore } from "@/lib/nss/surveyEngine";

function ClusterPill({ cluster }: { cluster: ClusterKey }) {
  return (
    // text-[#0f1729], not text-foreground: this pill's bg-white is a fixed
    // card color that never changes with the site's dark-mode toggle (see
    // SnapshotCard below), but text-foreground does — it goes near-white
    // in dark mode, which made this text disappear against its own
    // always-light background. Fixed to the same hex as --foreground's
    // light-mode value (globals.css), so it reads identically regardless
    // of site theme, matching the card's own fixed-light design.
    <span className="inline-flex items-center gap-2 bg-white rounded-full px-3.5 py-1.5 text-sm font-semibold text-[#0f1729]">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CLUSTER_COLORS[cluster] }} />
      {CLUSTER_LABELS[cluster]}
    </span>
  );
}

function SnapshotCard({
  bg,
  iconBg,
  iconShape,
  icon,
  title,
  clusters,
}: {
  bg: string;
  iconBg: string;
  iconShape: "circle" | "square";
  icon: ReactNode;
  title: string;
  clusters: ClusterKey[];
}) {
  return (
    <div className="rounded-2xl p-5 print:break-inside-avoid" style={{ backgroundColor: bg }}>
      <div className="flex items-center gap-3.5 mb-3.5">
        <div
          className={`w-9 h-9 flex items-center justify-center shrink-0 ${iconShape === "circle" ? "rounded-full" : "rounded-xl"}`}
          style={{ backgroundColor: iconBg }}
        >
          {icon}
        </div>
        {/* text-[#0f1729], not text-foreground — same fixed-color fix as ClusterPill above. */}
        <p className="font-heading text-base font-bold text-[#0f1729]">{title}</p>
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
        bg="#E3F1F1"
        iconBg="#008B93"
        iconShape="circle"
        icon={<ArrowUpRight className="w-4 h-4 text-white" strokeWidth={2.5} />}
        title="Your Leading Needs"
        clusters={leading}
      />
      <p className="text-muted-foreground leading-relaxed">
        Your other needs are important, too. They just didn&apos;t emerge as strongly in your choices.
      </p>
      <SnapshotCard
        bg="#EFEEF8"
        iconBg="#DAD9EC"
        iconShape="square"
        icon={<Grid2x2 className="w-4 h-4" style={{ color: "#6B6C8A" }} strokeWidth={2.5} />}
        title="Your Other Needs"
        clusters={other}
      />
    </div>
  );
}
