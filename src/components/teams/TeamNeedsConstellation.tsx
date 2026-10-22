"use client";

import { useMemo, useState } from "react";
import { CLUSTERS, CLUSTER_LABELS } from "@/lib/nss/clusters";
import { buildDistanceMatrix, classicalMDS, fitToUnitSquare, resolveOverlaps } from "@/lib/nss/teamConstellation";
import {
  describeClusterComparison,
  initialsFor,
  personIdentityColor,
  spectrumZoneFor,
  type TeamMemberScore,
} from "@/lib/nss/teamScores";

const BUBBLE_SIZE = 36;

// Thresholds follow Kruskal's standard stress-1 guideline (<0.05 good,
// 0.05-0.1 fair, 0.1-0.2 poor, >0.2 very poor). On the real six-person
// pilot data this lands at 0.177 ("poor") — flattening seven dimensions
// into two loses enough structure that the two people closest together
// in their real seven-cluster profiles are not the pair that ends up
// closest on the map. That's exactly the kind of distortion worth
// surfacing rather than silently presenting the layout as reliable.
function stressCaveat(stress: number): string | null {
  if (stress < 0.1) return null;
  if (stress < 0.2) {
    return "This map is a rough approximation — with a team this size, even which two people look closest together can shift from what their full seven-cluster profiles actually show. Use the comparison tool below for a reliable read on any specific pair.";
  }
  return "This team's profiles don't compress well into a flat map — positions here are only a loose sketch, not a reliable similarity measure. Use the comparison tool below instead for any specific pair.";
}

export default function TeamNeedsConstellation({ members }: { members: TeamMemberScore[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (members.length < 2) return null;
    const distances = buildDistanceMatrix(members.map((m) => m.favorability));
    const { coords, stress } = classicalMDS(distances);
    const positions = resolveOverlaps(fitToUnitSquare(coords));
    return { positions, stress };
  }, [members]);

  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(userId)) return prev.filter((id) => id !== userId);
      if (prev.length >= 2) return [userId];
      return [...prev, userId];
    });
  };

  const selectedMembers = selectedIds
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is TeamMemberScore => !!m);

  const comparison = useMemo(() => {
    if (selectedMembers.length !== 2) return null;
    const [a, b] = selectedMembers;
    const rows = CLUSTERS.map((cluster) => {
      const valueA = a.favorability[cluster];
      const valueB = b.favorability[cluster];
      return {
        cluster,
        valueA,
        valueB,
        diff: Math.abs(valueA - valueB),
        sameZone: spectrumZoneFor(valueA) === spectrumZoneFor(valueB),
        text: describeClusterComparison(cluster, a.firstName, valueA, b.firstName, valueB),
      };
    });
    const aligned = rows
      .filter((r) => r.sameZone)
      .sort((x, y) => x.diff - y.diff)
      .slice(0, 2);
    const differing = [...rows].sort((x, y) => y.diff - x.diff).slice(0, 2);
    return { aligned, differing };
  }, [selectedMembers]);

  if (members.length < 2) {
    return (
      <div className="bg-card border border-border/50 rounded-2xl p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Add at least two completed surveys to see how team members&apos; needs profiles compare.
        </p>
      </div>
    );
  }

  const caveat = stressCaveat(layout!.stress);
  const hoveredMember = hoveredId ? members.find((m) => m.userId === hoveredId) : null;

  return (
    <div>
      <div className="text-sm text-foreground min-h-[1.5rem] mb-2">
        {selectedMembers.length === 2 ? (
          <span className="font-medium">
            {selectedMembers[0].fullName} ↔ {selectedMembers[1].fullName}
          </span>
        ) : hoveredMember ? (
          <span>{hoveredMember.fullName}</span>
        ) : selectedMembers.length === 1 ? (
          <span className="text-muted-foreground">{selectedMembers[0].fullName} selected — click another bubble to compare.</span>
        ) : (
          <span className="text-muted-foreground">Click or tap two bubbles to compare their needs profiles.</span>
        )}
      </div>

      <div className="relative w-full max-w-xl mx-auto aspect-square rounded-2xl border border-border/50 bg-secondary/30">
        {layout!.positions.map(([x, y], i) => {
          const m = members[i];
          const isSelected = selectedIds.includes(m.userId);
          return (
            <button
              key={m.userId}
              type="button"
              onClick={() => toggleSelect(m.userId)}
              onMouseEnter={() => setHoveredId(m.userId)}
              onMouseLeave={() => setHoveredId((h) => (h === m.userId ? null : h))}
              onFocus={() => setHoveredId(m.userId)}
              onBlur={() => setHoveredId((h) => (h === m.userId ? null : h))}
              title={m.fullName}
              aria-label={`${m.fullName}${isSelected ? " (selected)" : ""}`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: BUBBLE_SIZE,
                height: BUBBLE_SIZE,
                backgroundColor: personIdentityColor(i, members.length),
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow flex items-center justify-center text-[10px] font-semibold text-white transition-transform ${
                isSelected ? "ring-2 ring-primary scale-110" : "hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
              }`}
            >
              {initialsFor(m)}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-muted-foreground max-w-md">
          People positioned closer together have more similar overall needs profiles. Distance reflects differences
          in relative priorities, not compatibility or how well people work together.
        </p>
        {selectedMembers.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-xs font-medium text-muted-foreground hover:text-foreground shrink-0 ml-3"
          >
            Clear selection
          </button>
        )}
      </div>

      {caveat && <p className="text-xs text-muted-foreground mt-2">{caveat}</p>}

      {comparison && (
        <div className="mt-4 bg-card border border-border/50 rounded-xl p-4">
          <p className="text-sm font-medium text-foreground mb-3">
            {selectedMembers[0].fullName} ↔ {selectedMembers[1].fullName}
          </p>

          <div className="mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Where Their Needs Align
            </h3>
            {comparison.aligned.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clusters landed in the same zone for both of them.</p>
            ) : (
              <ul className="space-y-1.5">
                {comparison.aligned.map((row) => (
                  <li key={row.cluster} className="text-sm text-foreground">
                    <span className="font-medium">{CLUSTER_LABELS[row.cluster]}</span>{" "}
                    <span className="text-muted-foreground">
                      ({Math.round(row.valueA * 100)}% / {Math.round(row.valueB * 100)}%)
                    </span>
                    <br />
                    <span className="text-muted-foreground">{row.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Where Their Needs Differ
            </h3>
            <ul className="space-y-1.5">
              {comparison.differing.map((row) => (
                <li key={row.cluster} className="text-sm text-foreground">
                  <span className="font-medium">{CLUSTER_LABELS[row.cluster]}</span>{" "}
                  <span className="text-muted-foreground">
                    ({Math.round(row.valueA * 100)}% / {Math.round(row.valueB * 100)}%)
                  </span>
                  <br />
                  <span className="text-muted-foreground">{row.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
