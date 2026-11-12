import { sendNrsEmail, type NrsSendOutcome } from "./emailSend";
import { CLUSTER_LABELS, type ClusterKey } from "./clusters";
import { NRS_CLUSTER_EMAIL_CONTENT } from "./clusterEmailContent";
import { NOVA_APP_EMAIL } from "@/lib/internalEmail";

// Wording is verbatim from the approved spec. For a real send,
// assessmentUrl must be the participant's ORIGINAL link (the caller
// reuses the submission's stored access_token — never a new one); for a
// `test` send the caller instead passes a fake, never-persisted token so
// the link can't actually be used to submit or modify anything on the
// real participant's behalf. All seven clusters share this one template;
// the cluster-specific sign-off lives in clusterEmailContent.ts. Real
// sends BCC the team's own inbox so they can see exactly what went out; a
// `test` send skips the BCC and marks the subject.
export async function sendNrsReminderEmail(params: {
  to: string;
  firstName: string;
  clusterKey: ClusterKey;
  assessmentUrl: string;
  logoUrl: string;
  submissionId: string;
  test?: boolean;
  testParticipantLabel?: string;
}): Promise<NrsSendOutcome> {
  const clusterName = CLUSTER_LABELS[params.clusterKey];
  const content = NRS_CLUSTER_EMAIL_CONTENT[params.clusterKey];

  const html = `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px; background-color:#ffffff; border-radius:12px; overflow:hidden;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background-color:#0a0e17; padding:28px 32px;">
                <img src="${params.logoUrl}" alt="Boldly Go Beyond" width="180" style="display:block;" />
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px;">
                <p style="margin:0 0 16px; font-size:14px; color:#6b7280;">Hey ${params.firstName},</p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Just a quick reminder to complete this week's <strong>${clusterName}</strong> reflection before your team conversation.
                </p>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#374151;">
                  It takes about five minutes to explore 10 workplace scenarios and consider how important ${clusterName} is for you to show up as your fullest on this team.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:8px; background-color:#0d9488;">
                      <a href="${params.assessmentUrl}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                        Complete your diagnostic
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  ${content.signoff}
                </p>

                <p style="margin:20px 0 2px; font-size:13px; color:#6b7280;">Ground Control 📡</p>
                <p style="margin:0; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:#9ca3af;">A Boldly Go Beyond Transmission</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();

  return sendNrsEmail({
    from: "Boldly Go Beyond <nova.app@boldlygobeyond.com>",
    to: params.to,
    subject: `${params.test ? `[TEST${params.testParticipantLabel ? ` for ${params.testParticipantLabel}` : ""}] ` : ""}A Quick Reminder: Your ${clusterName} Scan`,
    bcc: params.test ? undefined : NOVA_APP_EMAIL,
    html,
    tag: { name: "nrs_submission_id", value: params.submissionId },
  });
}
