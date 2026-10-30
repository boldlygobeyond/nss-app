import { sendNrsEmail, type NrsSendOutcome } from "./emailSend";

// Wording is verbatim from the approved spec — do not add a greeting,
// signature, or tagline beyond what's specified. Hardcoded to Core
// Stability for now (the only configured cluster); parameterizing by
// cluster is a TODO once a second cluster gets real content.
export async function sendNrsInviteEmail(params: {
  to: string;
  assessmentUrl: string;
  logoUrl: string;
  submissionId: string;
}): Promise<NrsSendOutcome> {
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
                  This week, we're exploring <strong>Core Stability</strong>, the needs that help us feel grounded, secure, and able to navigate our environment with confidence.
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">Core Stability's impact on how you show up</h2>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Let's take a look at how important Core Stability is for you to show up as your full self on this team.
                </p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Take five minutes to complete this quick diagnostic. You'll be presented with 10 workplace scenarios and asked to reflect on how important they are for you here.
                </p>

                <h2 style="margin:0 0 12px; font-size:18px; color:#111827;">Quick Reminder</h2>

                <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#374151;">
                  This isn't about how well the team is currently meeting your needs. It's about understanding how meaningful it is for you to have Core Stability fulfilled within this team.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
                  <tr>
                    <td style="border-radius:8px; background-color:#0d9488;">
                      <a href="${params.assessmentUrl}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                        Complete your diagnostic
                      </a>
                    </td>
                  </tr>
                </table>
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
    subject: "This Week's Needs Cluster: Core Stability",
    html,
    tag: { name: "nrs_submission_id", value: params.submissionId },
  });
}
