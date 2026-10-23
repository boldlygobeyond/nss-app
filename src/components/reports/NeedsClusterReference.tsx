import { CHART_ORDER, CLUSTER_LABELS, CLUSTER_COLORS, CLUSTER_DESCRIPTIONS } from "@/lib/nss/clusters";

// Shared "The 7 Needs Clusters" reference table — used on both the PDF
// cover and the on-screen report page, so the two stay in sync by
// construction rather than by two hand-maintained copies.
export default function NeedsClusterReference() {
  return (
    <div className="bg-accent/5 rounded-2xl p-5">
      <p className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase mb-4">The 7 Needs Clusters</p>
      <table className="w-full border-collapse">
        <tbody>
          {CHART_ORDER.map((cluster) => (
            <tr key={cluster} className="border-b border-border/30 last:border-0">
              <td className="py-2.5 pr-4 align-top whitespace-nowrap w-[32%]">
                <span className="inline-flex items-center gap-3 font-semibold text-foreground">
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: CLUSTER_COLORS[cluster] }} />
                  {CLUSTER_LABELS[cluster]}
                </span>
              </td>
              <td className="py-2.5 align-top text-muted-foreground text-sm leading-snug">
                {CLUSTER_DESCRIPTIONS[cluster]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
