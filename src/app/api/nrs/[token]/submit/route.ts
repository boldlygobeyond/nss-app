import { NextResponse, after } from "next/server";
import { getSubmissionByToken, submitNrsAssessment, claimResultsEmailSend } from "@/lib/nrs/submission";
import { sendNrsResultsEmail } from "@/lib/nrs/nrsResultsEmail";
import { logNrsSend } from "@/lib/nrs/sendLog";
import { getPublicOrigin } from "@/lib/publicOrigin";

// Finalizes the assessment: verifies all scenarios are answered, computes
// and stores the resonance score, and returns it. Safe to call twice in a
// row (a double-click, a retried request) — submitNrsAssessment's
// conditional update makes the second call a no-op against an unchanged
// score rather than a duplicate completion, and the results email below
// only ever fires on the call that actually transitioned the row.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = getPublicOrigin(request);
  const submission = await getSubmissionByToken(token);
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await submitNrsAssessment(submission.id, token);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (result.justCompleted) {
      // Fire-and-forget, after the response is already on its way back to
      // the participant — never blocks their "thanks, you're done"
      // confirmation on an email send.
      after(async () => {
        const claimed = await claimResultsEmailSend(submission.id);
        if (!claimed) return;
        const sendResult = await sendNrsResultsEmail({
          to: submission.roster.email,
          score: result.score,
          clusterKey: submission.clusterKey,
          logoUrl: `${origin}/logo/bgb-line-almond.png`,
          submissionId: submission.id,
        });
        await logNrsSend({ submissionId: submission.id, emailType: "results", outcome: sendResult });
      });
    }

    return NextResponse.json({ score: result.score });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not submit assessment" },
      { status: 400 },
    );
  }
}
