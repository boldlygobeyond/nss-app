import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubmissionByToken } from "@/lib/nrs/submission";
import { CLUSTER_LABELS } from "@/lib/nrs/clusters";

// Unauthenticated on purpose — this is the link a participant clicks from
// their invitation email, which can't assume an active app session.
// access_token is the only thing standing in for auth here, so a wrong or
// missing token is a flat 404, same posture as /api/nss/report-pdf-download.
//
// need_label is deliberately never selected/returned here — the
// participant-facing UI must never show the underlying need name, only
// the scenario text.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const submission = await getSubmissionByToken(token);
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const [{ data: questions, error: qError }, { data: responses, error: rError }] = await Promise.all([
    admin
      .from("nrs_questions")
      .select("id, display_order, scenario_text")
      .eq("cluster_key", submission.clusterKey)
      .order("display_order"),
    admin.from("nrs_responses").select("question_id, rating").eq("submission_id", submission.id),
  ]);
  if (qError) throw qError;
  if (rError) throw rError;

  return NextResponse.json({
    submissionId: submission.id,
    participantFirstName: submission.roster.firstName,
    clusterKey: submission.clusterKey,
    clusterName: CLUSTER_LABELS[submission.clusterKey],
    status: submission.status,
    resonanceScore: submission.resonanceScore,
    questions: (questions ?? []).map((q) => ({
      id: q.id,
      order: q.display_order,
      scenarioText: q.scenario_text,
    })),
    savedResponses: (responses ?? []).map((r) => ({ questionId: r.question_id, rating: r.rating })),
  });
}
