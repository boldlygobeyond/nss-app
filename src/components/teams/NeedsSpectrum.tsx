"use client";

import { useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import {
  assignSpectrumLanes,
  describeFavorability,
  initialsFor,
  personIdentityColor,
  spectrumPositionT,
  type TeamMemberScore,
} from "@/lib/nss/teamScores";

interface Selected {
  member: TeamMemberScore;
  cluster: ClusterKey;
}

const LANE_STEP = 18;
const DOT_SIZE = 28;

export default function NeedsSpectrum({
  members,
  rowOrder,
}: {
  members: TeamMemberScore[];
  rowOrder: ClusterKey[];
}) {
  const [selected, setSelected] = useState<Selected | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1 mb-2">
        <span>Lower relative priority</span>
        <span>Higher relative priority</span>
      </div>

      <div className="space-y-1">
        {rowOrder.map((cluster) => {
          // Lanes are assigned on the positions actually drawn on screen
          // (post-compression), not the raw favorability values — two dots
          // can be visually adjacent near the compressed edges even when
          // their raw values are further apart than they'd need to be in
          // the middle of the scale.
          const positions = members.map((m) => spectrumPositionT(m.favorability[cluster]));
          const lanes = assignSpectrumLanes(positions);
          const maxLane = lanes.reduce((max, l) => Math.max(max, Math.abs(l)), 0);
          const rowHeight = Math.max(56, 32 + (maxLane + 1) * LANE_STEP * 2);

          return (
            <div key={cluster} className="flex items-center gap-3">
              <div className="w-36 shrink-0 text-xs font-medium text-foreground text-right">
                {CLUSTER_LABELS[cluster]}
              </div>
              <div className="relative flex-1 min-w-[220px]" style={{ height: rowHeight }}>
                {/* Inset track — dots position at left:0%-100% *within this*,
                    so a dot never sits flush against the row's true edge
                    (which would clip it) without any calc() gymnastics. */}
                <div className="absolute left-5 right-5 top-0 bottom-0">
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
                  {members.map((m, i) => {
                    const value = m.favorability[cluster];
                    const lane = lanes[i];
                    const isSelected = selected?.member.userId === m.userId && selected.cluster === cluster;
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => setSelected({ member: m, cluster })}
                        title={`${m.fullName} — ${CLUSTER_LABELS[cluster]}`}
                        aria-label={`${m.fullName}, ${CLUSTER_LABELS[cluster]}: ${describeFavorability(value, m.firstName)}`}
                        style={{
                          left: `${positions[i] * 100}%`,
                          top: `calc(50% + ${lane * LANE_STEP}px)`,
                          width: DOT_SIZE,
                          height: DOT_SIZE,
                          backgroundColor: personIdentityColor(i, members.length),
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow flex items-center justify-center text-[9px] font-semibold text-white transition-transform ${
                          isSelected ? "ring-2 ring-primary scale-110" : "hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
                        }`}
                      >
                        {initialsFor(m)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 min-h-[2.5rem] rounded-lg bg-secondary/60 px-3 py-2 text-sm text-foreground">
        {selected ? (
          <>
            <span className="font-medium">{selected.member.fullName}</span>
            {" — "}
            <span>{CLUSTER_LABELS[selected.cluster]}</span>
            <span className="text-muted-foreground">
              {" · "}
              {describeFavorability(selected.member.favorability[selected.cluster], selected.member.firstName)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Click or tap any dot to see what it means.</span>
        )}
      </div>
    </div>
  );
}
