"use client";

import { useCallback, useRef, useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import {
  assignSpectrumLanes,
  describeFavorability,
  initialsFor,
  personIdentityColor,
  spectrumWithinZoneT,
  spectrumZoneFor,
  spectrumZoneTrackBounds,
  SPECTRUM_ZONE_LABELS,
  type SpectrumZone,
  type TeamMemberScore,
} from "@/lib/nss/teamScores";
import { useDismissOnOutsideOrEscape } from "@/lib/hooks/useDismissOnOutsideOrEscape";
import SnapshotDetailPanel from "./SnapshotDetailPanel";

interface Selected {
  member: TeamMemberScore;
  cluster: ClusterKey;
}

// Centered in the available space — every row (and the zone-label row
// above them) uses this exact same width/inset pair, so all seven spectra
// and their zone boundaries share identical left/right endpoints.
const TRACK_WIDTH = "w-[92%] min-w-[220px]";
const LANE_STEP = 13;
const DOT_SIZE = 28;
const DOT_RADIUS = DOT_SIZE / 2;

const ZONES: SpectrumZone[] = ["lower", "none", "stronger"];
const ZONE_SHADE: Record<SpectrumZone, string> = {
  lower: "bg-muted-foreground/[0.05]",
  none: "",
  stronger: "bg-primary/[0.05]",
};

// A fixed-pixel inset (not a plain percentage) so a dot's full circle —
// not just its center — stays clear of the dotted boundary at any
// rendered track width, including the narrowest mobile case, where a
// percentage-only inset could fall short of the dot's actual radius.
function zoneLeftCss(zone: SpectrumZone, t: number): string {
  const { trackMin, trackMax } = spectrumZoneTrackBounds(zone);
  const widthPct = (trackMax - trackMin) * 100;
  return `calc(${trackMin * 100}% + ${DOT_RADIUS}px + ${t} * (${widthPct}% - ${DOT_SIZE}px))`;
}

export default function NeedsSpectrum({
  members,
  rowOrder,
}: {
  members: TeamMemberScore[];
  rowOrder: ClusterKey[];
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => setSelected(null), []);
  useDismissOnOutsideOrEscape(containerRef, selected !== null, dismiss);

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex-1 min-w-0">
        {/* Plain flex row, not absolute-positioned — a label that wraps to
            2-3 lines on a narrow track needs the row to grow to fit it,
            which only happens in normal document flow. */}
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-36 shrink-0" />
          <div className="flex-1 min-w-[200px] flex justify-center">
            <div className={`flex ${TRACK_WIDTH}`}>
              {ZONES.map((zone) => {
                const { trackMin, trackMax } = spectrumZoneTrackBounds(zone);
                return (
                  <div
                    key={zone}
                    className="text-center text-[10px] leading-tight font-medium text-muted-foreground px-1"
                    style={{ width: `${(trackMax - trackMin) * 100}%` }}
                  >
                    {SPECTRUM_ZONE_LABELS[zone]}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-0.5">
          {rowOrder.map((cluster) => {
            // Lanes are assigned on an approximate rendered position (zone
            // track share + within-zone fraction) — close enough to decide
            // which dots are visually adjacent without needing the exact
            // pixel-aware calc() used for the dots' actual left position.
            const approxPositions = members.map((m) => {
              const value = m.favorability[cluster];
              const { trackMin, trackMax } = spectrumZoneTrackBounds(spectrumZoneFor(value));
              return trackMin + spectrumWithinZoneT(value) * (trackMax - trackMin);
            });
            // Widened from the default 0.025 — tightly clustered real values
            // (e.g. several people all landing in the high-80s/low-90s on
            // Emotional Ecosystem) were close enough to look crowded on
            // screen without being close enough to trigger staggering.
            const lanes = assignSpectrumLanes(approxPositions, 0.035);
            const maxLane = lanes.reduce((max, l) => Math.max(max, Math.abs(l)), 0);
            const rowHeight = Math.max(32, 18 + (maxLane + 1) * LANE_STEP * 2);

            return (
              <div key={cluster} className="flex items-center gap-3">
                <div className="w-36 shrink-0 text-xs font-medium text-foreground text-right">
                  {CLUSTER_LABELS[cluster]}
                </div>
                <div className="flex-1 min-w-[200px] flex justify-center">
                  <div className={`relative ${TRACK_WIDTH}`} style={{ height: rowHeight }}>
                    {ZONES.map((zone) => {
                      const { trackMin, trackMax } = spectrumZoneTrackBounds(zone);
                      return (
                        <div
                          key={zone}
                          className={`absolute top-0 bottom-0 ${ZONE_SHADE[zone]}`}
                          style={{ left: `${trackMin * 100}%`, width: `${(trackMax - trackMin) * 100}%` }}
                        />
                      );
                    })}
                    {/* Dotted zone boundaries — same x-position in every row
                        since every row shares the same TRACK_WIDTH, so they
                        read as continuous column dividers down the page. */}
                    <div
                      className="absolute top-0 bottom-0 border-l border-dotted border-muted-foreground/40"
                      style={{ left: `${spectrumZoneTrackBounds("none").trackMin * 100}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 border-l border-dotted border-muted-foreground/40"
                      style={{ left: `${spectrumZoneTrackBounds("stronger").trackMin * 100}%` }}
                    />
                    <div className="absolute left-0 right-0 top-1/2 h-px bg-border/60" />
                    {members.map((m, i) => {
                      const value = m.favorability[cluster];
                      const zone = spectrumZoneFor(value);
                      const within = spectrumWithinZoneT(value);
                      const lane = lanes[i];
                      const isSelected = selected?.member.userId === m.userId && selected.cluster === cluster;
                      return (
                        <button
                          key={m.userId}
                          type="button"
                          onClick={() => setSelected(isSelected ? null : { member: m, cluster })}
                          title={`${m.fullName} — ${CLUSTER_LABELS[cluster]}`}
                          aria-label={`${m.fullName}, ${CLUSTER_LABELS[cluster]}: ${describeFavorability(value, m.firstName)}`}
                          style={{
                            left: zoneLeftCss(zone, within),
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
      </div>

      <SnapshotDetailPanel
        name={selected?.member.fullName ?? null}
        cluster={selected ? CLUSTER_LABELS[selected.cluster] : null}
        description={
          selected ? describeFavorability(selected.member.favorability[selected.cluster], selected.member.firstName) : null
        }
      />
    </div>
  );
}
