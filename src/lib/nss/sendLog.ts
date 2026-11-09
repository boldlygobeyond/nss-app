import { createAdminClient } from "@/lib/supabase/admin";
import type { NssSendOutcome } from "./emailSend";

// Mirrors src/lib/nrs/sendLog.ts — the audit trail NSS never had: every
// email-send attempt (not just the latest touch) gets its own row,
// including mocked and failed attempts. Unlike NRS, submissionId and
// rosterId are both optional — at most one is set, depending on
// emailType (see migration 0030 for why none of the 4 NSS email types
// share one common key the way NRS's do).
export async function logNssSend(params: {
  recipientEmail: string;
  emailType: "admin_notification" | "respondent_report" | "team_invite" | "team_report_ready";
  outcome: NssSendOutcome;
  submissionId?: string | null;
  rosterId?: string | null;
  sentBy?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("nss_send_log").insert({
    recipient_email: params.recipientEmail,
    email_type: params.emailType,
    outcome: params.outcome.outcome,
    error_message: params.outcome.outcome === "failed" ? params.outcome.errorMessage : null,
    resend_message_id: params.outcome.outcome === "sent" ? params.outcome.resendMessageId : null,
    submission_id: params.submissionId ?? null,
    roster_id: params.rosterId ?? null,
    sent_by: params.sentBy ?? null,
  });
  if (error) {
    console.error("[nss-send-log] failed to record send attempt:", error);
  }
}
