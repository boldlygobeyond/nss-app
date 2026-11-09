import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { claimAndSendReminder } from "@/lib/nrs/reminder";
import { getPublicOrigin } from "@/lib/publicOrigin";

// Admin-only. Sends the reminder to one invited-but-incomplete
// participant. See claimAndSendReminder for the repeated-click guard —
// this route itself is a thin wrapper around it.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const origin = getPublicOrigin(request);
  const { submissionId } = await request.json();
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
  }

  const result = await claimAndSendReminder(submissionId, origin, admin.userId);
  return NextResponse.json(result);
}
