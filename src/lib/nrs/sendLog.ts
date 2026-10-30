import { createAdminClient } from "@/lib/supabase/admin";
import type { NrsSendOutcome } from "./emailSend";

// No equivalent audit trail exists in NSS today — every email-send
// attempt (not just the latest touch) gets its own row here, including
// mocked and failed attempts, satisfying "log all email attempts and
// timestamps."
export async function logNrsSend(params: {
  submissionId: string;
  emailType: "invitation" | "reminder" | "results";
  outcome: NrsSendOutcome;
  sentBy?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("nrs_send_log").insert({
    submission_id: params.submissionId,
    email_type: params.emailType,
    outcome: params.outcome.outcome,
    error_message: params.outcome.outcome === "failed" ? params.outcome.errorMessage : null,
    resend_message_id: params.outcome.outcome === "sent" ? params.outcome.resendMessageId : null,
    sent_by: params.sentBy ?? null,
  });
  if (error) {
    console.error("[nrs-send-log] failed to record send attempt:", error);
  }
}
