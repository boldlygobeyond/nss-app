import { NextResponse } from "next/server";
import { getSubmissionByToken, submitNrsAssessment } from "@/lib/nrs/submission";

// Finalizes the assessment: verifies all scenarios are answered, computes
// and stores the resonance score, and returns it. Safe to call twice in a
// row (a double-click, a retried request) — submitNrsAssessment's
// conditional update makes the second call a no-op against an unchanged
// score rather than a duplicate completion.
//
// TODO(Phase C): when result.justCompleted, fire the results email via
// after(), resolving the send-to address from submission.roster.email,
// and log the attempt to nrs_send_log.
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const submission = await getSubmissionByToken(token);
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await submitNrsAssessment(submission.id, token);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ score: result.score });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not submit assessment" },
      { status: 400 },
    );
  }
}
