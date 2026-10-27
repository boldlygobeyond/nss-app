"use client";

import { useRef, useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import { computeClusterAverages, groupByProximity, type TeamMemberScore } from "@/lib/nss/teamScores";
import { useDismissOnOutsideOrEscape } from "@/lib/hooks/useDismissOnOutsideOrEscape";

const DOT_SIZE = 14;
const DOT_RADIUS = DOT_SIZE / 2;
const ROW_TRACK_HEIGHT = 36;
const DOT_TEAL = "#009FAB";
const AVERAGE_NAVY = "#004850";
const AVERAGE_HASH_WIDTH = 4;
const AVERAGE_HASH_HEIGHT = DOT_SIZE + 18;

// Dot-center position as a 0-1 value mapped across the full track width,
// inset by the dot's own radius so a dot's full circle — not just its
// center — stays inside the track at any rendered width. Every row uses
// this exact same formula with no per-zone sub-ranges, so all seven
// spectra share identical left/right endpoints and one consistent scale.
function centerExpr(value: number): string {
  const t = Math.max(0, Math.min(1, value));
  return `(${DOT_RADIUS}px + ${t} * (100% - ${DOT_SIZE}px))`;
}

function rangeStyle(minValue: number, maxValue: number): { left: string; width: string } {
  return {
    left: `calc(${centerExpr(minValue)})`,
    width: `calc(${centerExpr(maxValue)} - ${centerExpr(minValue)})`,
  };
}

// A bit wider than the dots themselves it covers, for a comfortable
// hover/tap target — this is the only interactive element per group;
// the dots it sits behind are purely visual (pointer-events disabled).
function groupTargetStyle(minValue: number, maxValue: number): { left: string; width: string } {
  return {
    left: `calc(${centerExpr(minValue)} - ${DOT_RADIUS + 5}px)`,
    width: `calc(${centerExpr(maxValue)} - ${centerExpr(minValue)} + ${DOT_SIZE + 10}px)`,
  };
}

interface TooltipState {
  key: string;
  names: string[];
  pinned: boolean;
  top: number;
  left: number;
  placement: "above" | "below";
}

function computeTooltipPosition(el: HTMLElement): { top: number; left: number; placement: "above" | "below" } {
  const rect = el.getBoundingClientRect();
  const estWidth = 220;
  const left = Math.min(Math.max(rect.left + rect.width / 2, estWidth / 2 + 8), window.innerWidth - estWidth / 2 - 8);
  let top = rect.top - 10;
  let placement: "above" | "below" = "above";
  if (top < 56) {
    top = rect.bottom + 10;
    placement = "below";
  }
  return { top, left, placement };
}

export default function NeedsSpectrum({
  members,
  rowOrder,
}: {
  members: TeamMemberScore[];
  rowOrder: ClusterKey[];
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const averages = computeClusterAverages(members);

  useDismissOnOutsideOrEscape(containerRef, tooltip !== null, () => setTooltip(null));

  const openTooltip = (key: string, el: HTMLElement, names: string[], pinned: boolean) => {
    setTooltip({ key, names, pinned, ...computeTooltipPosition(el) });
  };
  const closeIfUnpinned = (key: string) => {
    setTooltip((t) => (t && t.key === key && !t.pinned ? null : t));
  };
  const toggleClick = (key: string, el: HTMLElement, names: string[]) => {
    setTooltip((t) => (t && t.key === key && t.pinned ? null : { key, names, pinned: true, ...computeTooltipPosition(el) }));
  };

  return (
    <div ref={containerRef}>
      <div className="flex flex-col gap-5">
        {rowOrder.map((cluster) => {
          const values = members.map((m) => m.favorability[cluster]);
          const minValue = Math.min(...values);
          const maxValue = Math.max(...values);
          const groups = groupByProximity(members, cluster);

          return (
            <div key={cluster}>
              <p className="text-xs font-medium text-foreground mb-1.5">{CLUSTER_LABELS[cluster]}</p>
              <div className="relative" style={{ height: ROW_TRACK_HEIGHT }}>
                {/* Spread shading — the min-to-max range across the team. */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-4 rounded-full"
                  style={{ ...rangeStyle(minValue, maxValue), backgroundColor: "rgba(0,159,171,0.14)" }}
                />
                {/* Baseline, visible through the translucent shading. */}
                <div className="absolute left-0 right-0 top-1/2 h-px bg-border/60" />
                {/* Team average — drawn behind the dots, never obscuring them. */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 rounded-sm"
                  style={{
                    left: `calc(${centerExpr(averages[cluster])} - ${AVERAGE_HASH_WIDTH / 2}px)`,
                    width: AVERAGE_HASH_WIDTH,
                    height: AVERAGE_HASH_HEIGHT,
                    backgroundColor: AVERAGE_NAVY,
                  }}
                />
                {/* Individual dots — purely visual; the group buttons below
                    are the actual hover/tap targets. */}
                {members.map((m) => (
                  <span
                    key={m.userId}
                    className="absolute top-1/2 rounded-full border-2 border-white pointer-events-none"
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
                {/* One hover/tap target per proximity group — if several
                    dots overlap, this is what reveals every name at that
                    position, since no single dot underneath can be
                    individually targeted once others sit on top of it. */}
                {groups.map((group, groupIndex) => {
                  const key = `${cluster}:${groupIndex}`;
                  const names = group.members.map((m) => m.fullName);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="absolute top-1/2 -translate-y-1/2 rounded-full"
                      style={{ ...groupTargetStyle(group.minValue, group.maxValue), height: DOT_SIZE + 14 }}
                      aria-label={names.join(", ")}
                      onMouseEnter={(e) => openTooltip(key, e.currentTarget, names, false)}
                      onMouseLeave={() => closeIfUnpinned(key)}
                      onFocus={(e) => openTooltip(key, e.currentTarget, names, false)}
                      onBlur={() => closeIfUnpinned(key)}
                      onClick={(e) => toggleClick(key, e.currentTarget, names)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-3 max-w-md mx-auto text-sm text-muted-foreground">
        <span>Less favored</span>
        <span>More favored</span>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg bg-foreground text-background text-xs font-medium shadow-lg pointer-events-none max-w-[220px] text-center"
          style={{
            top: tooltip.top,
            left: tooltip.left,
            transform: `translate(-50%, ${tooltip.placement === "above" ? "-100%" : "0"})`,
          }}
        >
          {tooltip.names.join(", ")}
        </div>
      )}
    </div>
  );
}
