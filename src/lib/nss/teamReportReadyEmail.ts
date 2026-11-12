import { sendNssEmail, type NssSendOutcome } from "./emailSend";
import { NOVA_APP_EMAIL } from "@/lib/internalEmail";

// Team/pilot version of respondentEmail.ts's "your report is ready" email —
// same visual chrome (logo, brand colors), but without the "now imagine
// your whole team" pitch and calendar-booking CTA at the bottom. Those
// exist to convert a lead into a sales conversation; a pilot team member
// is already a client, not someone to pitch. Wording is verbatim from the
// approved spec, Ground Control sign-off included — not the lead-facing
// Marc Chiu signature respondentEmail.ts keeps. Real sends BCC the team's
// own inbox so they can see exactly what went out; a `test` send skips
// the BCC and marks the subject.
export async function sendTeamReportReadyEmail(params: {
  to: string;
  firstName: string;
  submissionId: string;
  downloadUrl: string;
  logoUrl: string;
  test?: boolean;
}): Promise<NssSendOutcome> {
  const { to, firstName, submissionId, downloadUrl, logoUrl, test } = params;

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
                <img src="${logoUrl}" alt="Boldly Go Beyond" width="180" style="display:block;" />
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px;">
                <p style="margin:0 0 16px; font-size:14px; color:#6b7280;">Hey ${firstName},</p>
                <h1 style="margin:0 0 20px; font-size:22px; color:#111827;">Your signals are in!</h1>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Thanks for completing the Needs Signal Survey! Your personalized report is ready,
                  giving you a snapshot of which needs came forward most strongly for you.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:8px; background-color:#0d9488;">
                      <a href="${downloadUrl}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                        View Your Needs Signal Report
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Inside, you'll find insights into your needs, signals to pay attention to,
                  and questions to help you turn awareness into action.
                </p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Here's to new discoveries!
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

  return sendNssEmail({
    from: "Boldly Go Beyond <nova.app@boldlygobeyond.com>",
    to,
    subject: `${test ? "[TEST] " : ""}Your Needs Signal Report is ready 🚀`,
    bcc: test ? undefined : NOVA_APP_EMAIL,
    html,
    tag: { name: "submission_id", value: submissionId },
  });
}
