"use client";

// Branded, single-document capture target for the Team Snapshot PDF —
// cover-style header (same chrome as the individual Needs Signal Report's
// print cover) immediately followed by both snapshot charts, so
// renderReportPdf() can do one continuous page.pdf() capture. Not meant to
// be visited by a person — this exists purely for Puppeteer, same as
// reports/[id]/print/combined.
import { useEffect, useMemo } from "react";
import Image from "next/image";
import { computeTeamRowOrder, type TeamMemberScore } from "@/lib/nss/teamScores";
import TeamNeedsHeatmap from "@/components/teams/TeamNeedsHeatmap";
import NeedsSpectrumPrint from "@/components/teams/NeedsSpectrumPrint";

export default function TeamSnapshotPrintView({
  teamName,
  scores,
  surveyDateLabel,
  onReady,
}: {
  teamName: string;
  scores: TeamMemberScore[];
  // "Month Year" the surveys were actually completed — not today's date,
  // since this snapshot can be downloaded well after the fact.
  surveyDateLabel: string | null;
  onReady: () => void;
}) {
  // Stable array reference across re-renders (e.g. the parent re-rendering
  // after onReady fires) — NeedsSpectrumPrint's layout effect depends on
  // this identity to know when it actually needs to re-measure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowOrder = useMemo(() => computeTeamRowOrder(scores), [scores.length]);

  // Nothing to measure-then-layout when there's no data — signal ready
  // immediately rather than waiting on a layout pass NeedsSpectrumPrint
  // never gets mounted to run.
  useEffect(() => {
    if (scores.length === 0) onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores.length]);

  return (
    <div className="print-light bg-white text-foreground">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <Image src="/logo/bgb-line-all-color.png" alt="Boldly Go Beyond" width={200} height={20} priority className="mb-3" />
          <h1 className="font-heading text-2xl leading-tight font-bold text-foreground">Needs Signal Survey</h1>
          <div className="h-1 w-12 rounded-full bg-accent mt-2" />
        </div>
        <div className="text-right pt-1">
          <p className="text-[0.65rem] font-bold tracking-[0.18em] text-muted-foreground uppercase mb-1">
            Team Snapshot
          </p>
          <p className="text-xl font-bold text-foreground">{teamName}</p>
          <p className="text-sm text-muted-foreground">
            {surveyDateLabel ? `${surveyDateLabel} · ` : ""}
            {scores.length} team member{scores.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {scores.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed surveys yet.</p>
      ) : (
        <>
          {/* Each report gets its own full landscape page rather than
              sharing one — a half-width chart read too small to send to
              leaders. print:break-after-page forces the hard page break;
              the second section repeats a lightweight context line since
              it's now a page someone could view on its own. */}
          <section className="print:break-after-page">
            <h2 className="font-heading text-lg font-semibold text-foreground mb-1">Our Needs at a Glance</h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-nowrap mb-4">
              Each cell shows how strongly that person prioritizes this need relative to their other six — darker
              is more favored.
            </p>
            <TeamNeedsHeatmap members={scores} rowOrder={rowOrder} />
          </section>

          <section>
            <p className="text-xs text-muted-foreground mb-1 text-right">
              {teamName} · Team Snapshot
            </p>
            <h2 className="font-heading text-lg font-semibold text-foreground mb-4">Where We Align &amp; Differ</h2>
            <NeedsSpectrumPrint members={scores} rowOrder={rowOrder} onReady={onReady} />
          </section>
        </>
      )}
    </div>
  );
}
