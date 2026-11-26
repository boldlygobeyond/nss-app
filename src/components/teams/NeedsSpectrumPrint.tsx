"use client";

// Static, label-annotated variant of NeedsSpectrum for the branded PDF
// snapshot — a flat page has no hover, so every dot (or overlapping group
// of dots) needs its name(s) printed directly on the chart instead of
// revealed on hover. Shares its positioning math with NeedsSpectrum so the
// two charts can never drift apart visually.
//
// Every label starts centered directly over its dot/group, then two
// independent corrections apply from one measurement pass: (1) a label
// that would overflow past the row's left/right edge (e.g. a name near
// the very top or bottom of the scale) gets nudged back inside, and (2) a
// label that would then collide with a neighboring label gets stacked
// onto a higher "tier" instead. Either correction draws a short L-shaped
// leader line (a vertical segment at the dot's true x, plus a horizontal
// jog if the label was also nudged) back down to the dot it belongs to,
// since it's no longer directly above it.
import { useLayoutEffect, useRef, useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import { computeClusterAverages, groupByProximity, type TeamMemberScore } from "@/lib/nss/teamScores";
import { DOT_SIZE, centerExpr } from "./NeedsSpectrum";

const ROW_TRACK_HEIGHT = 27;
const DOT_TEAL = "#009FAB";
const AVERAGE_NAVY = "#004850";
const AVERAGE_HASH_WIDTH = 4;
const AVERAGE_HASH_HEIGHT = DOT_SIZE + 18;
const LABEL_FONT_SIZE = 11;
const LABEL_ROW_HEIGHT = 14;
const TIER_GAP = 3;
const LABEL_TRACK_GAP = 6;
const LABEL_H_GAP = 10; // minimum horizontal clearance required between two labels sharing a tier
const LABEL_EDGE_PADDING = 3; // keeps a label from touching the row's own left/right edge

function rangeStyle(minValue: number, maxValue: number): { left: string; width: string } {
  return {
    left: `calc(${centerExpr(minValue)})`,
    width: `calc(${centerExpr(maxValue)} - ${centerExpr(minValue)})`,
  };
}

export default function NeedsSpectrumPrint({
  members,
  rowOrder,
  onReady,
}: {
  members: TeamMemberScore[];
  rowOrder: ClusterKey[];
  // Lets the print page know when the measure-then-layout pass has
  // settled, so it can gate Puppeteer's capture on a DOM marker instead of
  // racing a fixed timeout — see data-ready below.
  onReady?: () => void;
}) {
  const averages = computeClusterAverages(members);
  const labelRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const rowRefs = useRef<Map<ClusterKey, HTMLDivElement>>(new Map());
  const [tiers, setTiers] = useState<Record<string, number>>({});
  const [dx, setDx] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  const rowGroups = rowOrder.map((cluster) => ({
    cluster,
    minValue: Math.min(...members.map((m) => m.favorability[cluster])),
    maxValue: Math.max(...members.map((m) => m.favorability[cluster])),
    groups: groupByProximity(members, cluster),
  }));

  useLayoutEffect(() => {
    const nextTiers: Record<string, number> = {};
    const nextDx: Record<string, number> = {};
    rowGroups.forEach(({ cluster, groups }) => {
      const rowEl = rowRefs.current.get(cluster);
      const rowRect = rowEl?.getBoundingClientRect();

      const items = groups
        .map((_, i) => {
          const key = `${cluster}:${i}`;
          const el = labelRefs.current.get(key);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          // The DOM always reflects whatever dx was applied on the *previous*
          // commit (this effect can legitimately run more than once — e.g.
          // the parent recomputing rowOrder as a fresh array reference on an
          // unrelated re-render) — so measuring the live rect directly and
          // clamping from there is not idempotent: a correction that lands a
          // label just inside the edge reads back as "already fits" on the
          // next run and gets reset to 0, re-introducing the overflow it had
          // just fixed. Subtracting out the currently-applied dx first
          // reconstructs the true natural (dx=0) position every time, so
          // re-running this always recomputes the same answer.
          const currentDx = dx[key] ?? 0;
          const naturalLeft = rect.left - currentDx;
          const naturalRight = rect.right - currentDx;

          let itemDx = 0;
          if (rowRect) {
            if (naturalLeft < rowRect.left + LABEL_EDGE_PADDING) {
              itemDx = rowRect.left + LABEL_EDGE_PADDING - naturalLeft;
            } else if (naturalRight > rowRect.right - LABEL_EDGE_PADDING) {
              itemDx = rowRect.right - LABEL_EDGE_PADDING - naturalRight;
            }
          }
          return { key, left: naturalLeft + itemDx, right: naturalRight + itemDx, dx: itemDx };
        })
        .filter((x): x is { key: string; left: number; right: number; dx: number } => x !== null)
        .sort((a, b) => a.left - b.left);

      // Greedy first-fit interval packing on the already-clamped positions
      // — each tier's occupied span only ever grows rightward (items are
      // processed in left-to-right order), so a tier's placed labels are
      // guaranteed non-overlapping by construction — no second pass needed.
      const tierRightEdge: number[] = [];
      items.forEach((item) => {
        let tier = tierRightEdge.findIndex((edge) => item.left >= edge + LABEL_H_GAP);
        if (tier === -1) {
          tier = tierRightEdge.length;
          tierRightEdge.push(item.right);
        } else {
          tierRightEdge[tier] = item.right;
        }
        nextTiers[item.key] = tier;
        nextDx[item.key] = item.dx;
      });
    });
    setTiers(nextTiers);
    setDx(nextDx);
    setReady(true);
    onReady?.();
    // rowGroups is rebuilt fresh every render from members/rowOrder — depend
    // on those actual inputs instead so this doesn't loop on its own output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, rowOrder]);

  const maxTierByCluster: Record<string, number> = {};
  rowGroups.forEach(({ cluster, groups }) => {
    let max = 0;
    groups.forEach((_, i) => {
      max = Math.max(max, tiers[`${cluster}:${i}`] ?? 0);
    });
    maxTierByCluster[cluster] = max;
  });

  return (
    <div data-ready={ready ? "true" : undefined}>
      <div className="flex flex-col gap-2">
        {rowGroups.map(({ cluster, minValue, maxValue, groups }, idx) => {
          const maxTier = maxTierByCluster[cluster] ?? 0;
          const labelAreaHeight = (maxTier + 1) * LABEL_ROW_HEIGHT + maxTier * TIER_GAP + LABEL_TRACK_GAP;
          const isLast = idx === rowGroups.length - 1;
          return (
            // A border under every row but the last — with seven rows this
            // close together, whitespace alone left it ambiguous which
            // track a given cluster's dots actually sat on.
            <div key={cluster} className={isLast ? "" : "border-b border-border/30"}>
              <p className="text-xs font-medium text-foreground mb-1">{CLUSTER_LABELS[cluster]}</p>
              <div
                ref={(el) => {
                  if (el) rowRefs.current.set(cluster, el);
                  else rowRefs.current.delete(cluster);
                }}
                className="relative"
                style={{ height: labelAreaHeight + ROW_TRACK_HEIGHT }}
              >
                {groups.map((group, i) => {
                  const key = `${cluster}:${i}`;
                  const tier = tiers[key] ?? 0;
                  const labelDx = dx[key] ?? 0;
                  const centerValue = (group.minValue + group.maxValue) / 2;
                  const bottomOffset = ROW_TRACK_HEIGHT / 2 + LABEL_TRACK_GAP + tier * (LABEL_ROW_HEIGHT + TIER_GAP);
                  const needsLeader = tier > 0 || labelDx !== 0;
                  return (
                    <div key={key}>
                      {needsLeader && (
                        <>
                          <div
                            className="absolute bg-border"
                            style={{
                              left: `calc(${centerExpr(centerValue)})`,
                              width: 1,
                              bottom: ROW_TRACK_HEIGHT / 2,
                              height: bottomOffset - ROW_TRACK_HEIGHT / 2,
                            }}
                          />
                          {labelDx !== 0 && (
                            <div
                              className="absolute bg-border"
                              style={{
                                left: `calc(${centerExpr(centerValue)} + ${Math.min(0, labelDx)}px)`,
                                width: Math.abs(labelDx),
                                bottom: bottomOffset,
                                height: 1,
                              }}
                            />
                          )}
                        </>
                      )}
                      <span
                        ref={(el) => {
                          if (el) labelRefs.current.set(key, el);
                          else labelRefs.current.delete(key);
                        }}
                        className="absolute whitespace-nowrap font-medium text-foreground"
                        style={{
                          left: `calc(${centerExpr(centerValue)} + ${labelDx}px)`,
                          bottom: bottomOffset,
                          transform: "translateX(-50%)",
                          fontSize: LABEL_FONT_SIZE,
                          lineHeight: `${LABEL_ROW_HEIGHT}px`,
                        }}
                      >
                        {group.members.map((m) => m.fullName).join(", ")}
                      </span>
                    </div>
                  );
                })}

                <div className="absolute left-0 right-0" style={{ bottom: 0, height: ROW_TRACK_HEIGHT }}>
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-4 rounded-full"
                    style={{ ...rangeStyle(minValue, maxValue), backgroundColor: "rgba(0,159,171,0.14)" }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 rounded-sm"
                    style={{
                      left: `calc(${centerExpr(averages[cluster])} - ${AVERAGE_HASH_WIDTH / 2}px)`,
                      width: AVERAGE_HASH_WIDTH,
                      height: AVERAGE_HASH_HEIGHT,
                      backgroundColor: AVERAGE_NAVY,
                    }}
                  />
                  {members.map((m) => (
                    <span
                      key={m.userId}
                      className="absolute top-1/2 rounded-full border-2 border-white"
                      style={{
                        left: `calc(${centerExpr(m.favorability[cluster])})`,
                        transform: "translate(-50%, -50%)",
                        width: DOT_SIZE,
                        height: DOT_SIZE,
                        backgroundColor: DOT_TEAL,
                        opacity: 0.85,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-2 max-w-md mx-auto text-sm text-muted-foreground">
        <span className="shrink-0">Less favored</span>
        <div className="flex-1 relative h-3">
          <div className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 h-px bg-muted-foreground/40" />
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-[4px] border-y-transparent border-r-[6px] border-r-muted-foreground/40" />
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-muted-foreground/40" />
        </div>
        <span className="shrink-0">More favored</span>
      </div>
    </div>
  );
}
