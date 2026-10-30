import { sendNrsEmail, type NrsSendOutcome } from "./emailSend";
import { buildInterpretation } from "./interpretiveCopy";

// Wording is verbatim from the approved spec, apart from the single
// dynamically-populated score + its deterministic, template-based
// interpretation (see interpretiveCopy.ts). No CTA button — the spec
// doesn't specify one for this email.
export async function sendNrsResultsEmail(params: {
  to: string;
  score: number;
  logoUrl: string;
  submissionId: string;
}): Promise<NrsSendOutcome> {
  const scoreFixed = params.score.toFixed(1);
  const interpretation = buildInterpretation(params.score);

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
                <h1 style="margin:0 0 20px; font-size:22px; color:#111827;">Your Core Stability Resonance Snapshot</h1>

                <p style="margin:0 0 20px; font-size:16px; font-weight:600; color:#111827;">
                  Your resonance score: ${scoreFixed} / 5
                </p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  ${interpretation}
                </p>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#374151;">
                  Remember, this score reflects how meaningful it is for you to experience Core Stability within this team, not how well the team is currently meeting these needs.
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">Notice this week</h2>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#374151;">
                  As you go through your week, notice when Core Stability shows up in your experiences. Consider what helps you feel grounded and secure, and how meeting or not meeting these needs affect the way you show up.
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">Bring it to the conversation</h2>

                <p style="margin:0 0 8px; font-size:15px; line-height:1.6; color:#374151;">
                  During your weekly team meeting, you'll explore how Core Stability resonates with the team and how you can help create an environment where everyone can show up fully.
                </p>
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
    from: "Boldly Go Beyond Diagnostics <first.contact@boldlygobeyond.com>",
    to: params.to,
    subject: "Your Core Stability Resonance Snapshot",
    html,
    tag: { name: "nrs_submission_id", value: params.submissionId },
  });
}
