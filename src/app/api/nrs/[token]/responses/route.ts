import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSubmissionByToken } from "@/lib/nrs/submission";

// Writes one scenario's rating. Resolves the submission id server-side
// from the token (never trusts a client-supplied submission id), then
// delegates the actual write to upsert_nrs_response(), which re-verifies
// the token itself — this route doesn't need the service-role client at
// all, only the plain (anon-key, no session) client, since the
// SECURITY DEFINER RPC's own token check is what grants access. A
// participant never has a Supabase session, so this request naturally
// runs as Postgres's anon role, which the RPC is explicitly granted to.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => null);
  const questionId = body?.questionId;
  const rating = body?.rating;
  if (typeof questionId !== "number" || typeof rating !== "number") {
    return NextResponse.json({ error: "questionId and rating are required" }, { status: 400 });
  }

  const submission = await getSubmissionByToken(token);
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_nrs_response", {
    p_submission_id: submission.id,
    p_access_token: token,
    p_question_id: questionId,
    p_rating: rating,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
