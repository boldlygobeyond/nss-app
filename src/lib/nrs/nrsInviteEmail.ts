import { sendNrsEmail, type NrsSendOutcome } from "./emailSend";
import { CLUSTER_LABELS, type ClusterKey } from "./clusters";
import { NRS_CLUSTER_EMAIL_CONTENT } from "./clusterEmailContent";
import { NOVA_APP_EMAIL } from "@/lib/internalEmail";

// Wording is verbatim from the approved spec — do not add anything beyond
// what's specified. All seven clusters share this one template; the
// cluster-specific fragments (opening clause, possessive heading,
// sign-off) live in clusterEmailContent.ts. Real sends BCC the team's own
// inbox so they can see exactly what went out; a `test` send skips the
// BCC and marks the subject.
export async function sendNrsInviteEmail(params: {
  to: string;
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
                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  This week, we're exploring <strong>${clusterName}</strong>, the needs that help us feel ${content.opening}
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">${content.possessive} impact on how you show up</h2>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Let's take a look at how important ${clusterName} is for you to show up as your full self on this team.
                </p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Take five minutes to complete this quick diagnostic. You'll be presented with 10 workplace scenarios and asked to reflect on how important they are for you on this team.
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">Quick Reminder</h2>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#374151;">
                  This isn't about how well the team is currently meeting your needs. It's about understanding how meaningful it is for you to have ${clusterName} needs fulfilled on this team.
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
    subject: `${params.test ? `[TEST${params.testParticipantLabel ? ` for ${params.testParticipantLabel}` : ""}] ` : ""}This Week's Needs Cluster: ${clusterName}`,
    bcc: params.test ? undefined : NOVA_APP_EMAIL,
    html,
    tag: { name: "nrs_submission_id", value: params.submissionId },
  });
}
