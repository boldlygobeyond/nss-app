import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { CHART_ORDER, CLUSTER_LABELS, CLUSTER_COLORS, type ClusterKey } from "@/lib/nss/clusters";
import type { ClusterScore } from "@/lib/nss/surveyEngine";
import { spectrumZoneFor, type SpectrumZone } from "@/lib/nss/teamScores";

const ZONE_CONFIG: Record<
  SpectrumZone,
  { title: string; description: string; bg: string; iconBg: string; titleColor: string; Icon: typeof ArrowUpRight }
> = {
  stronger: {
    title: "Stronger Priority Signals",
    description: "These needs emerged as higher priorities when compared with your other needs.",
    bg: "#E3F1F1",
    iconBg: "#008B93",
    titleColor: "#008B93",
    Icon: ArrowUpRight,
  },
  lower: {
    title: "Lower Priority Signals",
    description:
      "These needs emerged as lower priorities when compared with your other needs. That doesn't mean they're unimportant.",
    bg: "#FBEEF2",
    iconBg: "#B8366B",
    titleColor: "#B8366B",
    Icon: ArrowDownRight,
  },
  none: {
    title: "No Strong Signal",
    description: "Your choices didn't show a strong overall preference toward or away from these needs relative to your others.",
    bg: "#EFEEF8",
    iconBg: "#8B8CA8",
    titleColor: "#6B6C8A",
    Icon: Minus,
  },
};

const ZONE_ORDER: SpectrumZone[] = ["stronger", "lower", "none"];

export default function NeedsSignalZones({ scores }: { scores: Record<ClusterKey, ClusterScore> | null }) {
  if (!scores) return null;

  const zones: Record<SpectrumZone, ClusterKey[]> = { stronger: [], lower: [], none: [] };
  CHART_ORDER.forEach((cluster) => {
    const value = scores[cluster]?.winRate ?? 0.5;
    zones[spectrumZoneFor(value)].push(cluster);
  });

  // Strongest-first within each zone — the same rank order the rest of
  // the report already uses for "top needs" (choiceInsights, signals,
  // etc.), so a reader sees the same ranking everywhere instead of this
  // section's chips sitting in an unrelated fixed display order.
  (Object.keys(zones) as SpectrumZone[]).forEach((zone) => {
    zones[zone].sort((a, b) => (scores[b]?.winRate ?? 0.5) - (scores[a]?.winRate ?? 0.5));
  });

  return (
    <div className="flex flex-col gap-4">
      {ZONE_ORDER.map((zone) => {
        const config = ZONE_CONFIG[zone];
        const clusters = zones[zone];
        return (
          <div key={zone} className="rounded-2xl p-5 print:break-inside-avoid" style={{ backgroundColor: config.bg }}>
            <div className="flex items-start gap-3.5 mb-3.5">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: config.iconBg }}
              >
                <config.Icon className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <p className="font-heading text-base font-bold mb-1" style={{ color: config.titleColor }}>
                  {config.title}
                </p>
                <p className="text-sm text-muted-foreground max-w-md">{config.description}</p>
              </div>
            </div>
            {clusters.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No clusters landed in this zone for this snapshot.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {clusters.map((cluster) => (
                  <span
                    key={cluster}
                    className="inline-flex items-center gap-2 bg-white rounded-full px-3.5 py-1.5 text-sm font-semibold"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: CLUSTER_COLORS[cluster] }}
                    />
                    {CLUSTER_LABELS[cluster]}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
