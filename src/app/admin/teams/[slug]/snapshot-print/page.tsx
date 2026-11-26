"use client";

// PDF capture target for the Team Snapshot download — not meant to be
// visited by a person; /admin/teams/[slug] (the on-screen, interactive
// Snapshot tab) is the human-facing route. Mirrors
// reports/[id]/print/combined/CombinedClient.tsx's role in the individual
// Needs Signal Report PDF pipeline.
import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { loadTeamSnapshotScores } from "@/lib/nss/teamSnapshot";
import type { TeamMemberScore } from "@/lib/nss/teamScores";
import TeamSnapshotPrintView from "@/components/teams/TeamSnapshotPrintView";

export default function TeamSnapshotPrintPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [authorized, setAuthorized] = useState(false);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [scores, setScores] = useState<TeamMemberScore[] | null>(null);
  const [surveyDateLabel, setSurveyDateLabel] = useState<string | null>(null);
  const [spectrumReady, setSpectrumReady] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const profile = await getMyProfile(supabase, user.id);
      if (profile?.role !== "admin") return;
      setAuthorized(true);

      const { data: teamRow } = await supabase.from("teams").select("name").eq("slug", slug).maybeSingle();
      if (!teamRow) return;
      setTeamName(teamRow.name);
      setScores(await loadTeamSnapshotScores(supabase, slug));

      // "Month Year" the surveys were actually completed, not today's
      // date — this snapshot can be downloaded long after the fact, and
      // what matters to a reader is when the underlying data is from.
      // Latest completion across the team stands in for "when this round
      // of surveys was taken".
      const { data: completedRows } = await supabase
        .from("nss_submissions")
        .select("completed_at, status")
        .eq("team", slug)
        .in("status", ["completed", "report_generated"]);
      const latestCompletedAt = (completedRows ?? [])
        .map((r) => r.completed_at)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1);
      if (latestCompletedAt) {
        setSurveyDateLabel(new Date(latestCompletedAt).toLocaleDateString("en-US", { year: "numeric", month: "long" }));
      }
    };
    load();
  }, [slug]);

  if (!authorized || teamName === null || scores === null) return null;

  return (
    <div
      className="w-full px-10 py-10 print:p-0"
      // Puppeteer waits on this selector before capturing — gates the
      // capture on the spectrum chart's own measure-then-layout pass
      // instead of racing a fixed timeout. See pdfRender.ts.
      data-ready={spectrumReady ? "true" : undefined}
    >
      <TeamSnapshotPrintView
        teamName={teamName}
        scores={scores}
        surveyDateLabel={surveyDateLabel}
        onReady={() => setSpectrumReady(true)}
      />
    </div>
  );
}
