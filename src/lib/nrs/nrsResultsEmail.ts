import { sendNrsEmail, type NrsSendOutcome } from "./emailSend";
import { buildInterpretation } from "./interpretiveCopy";
import { CLUSTER_LABELS, type ClusterKey } from "./clusters";
import { NRS_CLUSTER_EMAIL_CONTENT } from "./clusterEmailContent";
import { NOVA_APP_EMAIL } from "@/lib/internalEmail";

// Wording is verbatim from the approved spec, apart from the single
// dynamically-populated score + its deterministic, template-based
// interpretation (see interpretiveCopy.ts). No CTA button — the spec
// doesn't specify one for this email. All seven clusters share this one
// template; the cluster-specific "See the Signals" reflection questions
// and sign-off live in clusterEmailContent.ts. Real sends BCC the team's
// own inbox so they can see exactly what went out; a `test` send skips
// the BCC and marks the subject.
export async function sendNrsResultsEmail(params: {
  to: string;
  score: number;
  clusterKey: ClusterKey;
  logoUrl: string;
  submissionId: string;
  test?: boolean;
}): Promise<NrsSendOutcome> {
  const clusterName = CLUSTER_LABELS[params.clusterKey];
  const content = NRS_CLUSTER_EMAIL_CONTENT[params.clusterKey];
  const scoreFixed = params.score.toFixed(1);
  const { label, interpretation } = buildInterpretation(params.score, clusterName);

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
                <h1 style="margin:0 0 20px; font-size:22px; color:#111827;">Your ${clusterName} Resonance Snapshot</h1>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="background-color:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; padding:20px 22px;">
                      <p style="margin:0 0 8px; font-size:16px; font-weight:600; color:#111827;">
                        Your resonance score: ${scoreFixed} / 5
                      </p>
                      <p style="margin:0; font-size:15px; line-height:1.6; color:#374151;">
                        <strong>${label}:</strong> ${interpretation}
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#374151;">
                  This score helps you understand how important <strong>${clusterName}</strong> is to you on this team. As we continue exploring our needs together, we'll start noticing when they're being met, when they're not, and how that shapes our experiences at work.
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">See the Signals</h2>

                <p style="margin:0 0 12px; font-size:15px; line-height:1.6; color:#374151;">
                  As you go through your week, pay attention to your signals. If any of the following come up, take a moment to reflect:
                </p>

                <ul style="margin:0 0 24px; padding-left:20px; font-size:15px; line-height:1.6; color:#374151;">
                  <li style="margin-bottom:8px;">${content.reflectionQuestions[0]}</li>
                  <li>${content.reflectionQuestions[1]}</li>
                </ul>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">Bring it to the conversation</h2>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  During your weekly team meeting, you'll start to explore how ${clusterName} resonates with the team and how you can help create an environment where everyone can show up fully.
                </p>

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
    subject: `${params.test ? "[TEST] " : ""}Your ${clusterName} Resonance Snapshot`,
    bcc: params.test ? undefined : NOVA_APP_EMAIL,
    html,
    tag: { name: "nrs_submission_id", value: params.submissionId },
  });
}
