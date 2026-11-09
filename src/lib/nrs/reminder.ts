import { createAdminClient } from "@/lib/supabase/admin";
import { sendNrsReminderEmail } from "./nrsReminderEmail";
import { logNrsSend } from "./sendLog";

const REMINDER_COOLDOWN_SECONDS = 60;

export type ReminderAttemptResult =
  | { skipped: true; reason: string }
  | { skipped: false; outcome: "sent" | "mocked" | "failed" };

// The repeated-click / rate-limit guard shared by both the single-
// recipient and bulk remind routes, so the guard and the send+log
// sequence can't drift between them. Claims the right to send only if
// this submission isn't completed and wasn't reminded in the last 60s —
// a genuine accidental double-click lands well inside that window; a
// legitimate "remind again next week" is far outside it. Zero rows
// claimed means skip, not send again.
export async function claimAndSendReminder(
  submissionId: string,
  origin: string,
  sentByUserId: string,
): Promise<ReminderAttemptResult> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_SECONDS * 1000).toISOString();

  const { data: claimed, error: claimError } = await admin
    .from("nrs_submissions")
    .update({ last_reminder_at: new Date().toISOString() })
    .eq("id", submissionId)
    .neq("status", "completed")
    .or(`last_reminder_at.is.null,last_reminder_at.lt.${cutoff}`)
    .select("id, access_token, team_roster(first_name, email)")
    .maybeSingle();
  if (claimError || !claimed) {
    return { skipped: true, reason: "Already completed, or reminded within the last minute" };
  }

  const roster = Array.isArray(claimed.team_roster) ? claimed.team_roster[0] : claimed.team_roster;
  if (!roster) {
    return { skipped: true, reason: "Roster member not found" };
  }

  const sendResult = await sendNrsReminderEmail({
    to: roster.email,
    firstName: roster.first_name,
    assessmentUrl: `${origin}/nrs/${claimed.access_token}`,
    logoUrl: `${origin}/logo/bgb-line-almond.png`,
    submissionId: claimed.id,
  });
  await logNrsSend({ submissionId: claimed.id, emailType: "reminder", outcome: sendResult, sentBy: sentByUserId });

  return { skipped: false, outcome: sendResult.outcome };
}
