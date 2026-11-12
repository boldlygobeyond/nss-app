import { sendNssEmail, type NssSendOutcome } from "./emailSend";
import { NOVA_APP_EMAIL } from "@/lib/internalEmail";

// Sends a pilot/team member their invite link. Same visual chrome as
// respondentEmail.ts (logo, brand colors) so it reads as the same
// product, but different copy — this is "come take the survey," not
// "your results are ready," and deliberately has no calendar-booking
// pitch: a chamber member already in a paid pilot doesn't need the
// lead-conversion ask the report email ends on. Wording is verbatim from
// the approved spec, Ground Control sign-off included — do not add the
// lead-facing Marc Chiu signature back in, that email (respondentEmail.ts)
// is the only one that keeps it. Real sends BCC the team's own inbox so
// they can see exactly what went out; a `test` send skips the BCC
// (pointless once `to` is already that inbox) and marks the subject.
export async function sendTeamInviteEmail(params: {
  to: string;
  firstName: string;
  inviteUrl: string;
  logoUrl: string;
  test?: boolean;
  testParticipantLabel?: string;
}): Promise<NssSendOutcome> {
  const { to, firstName, inviteUrl, logoUrl, test, testParticipantLabel } = params;

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
                <h1 style="margin:0 0 20px; font-size:22px; color:#111827;">What comes first when everything matters?</h1>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  The <strong>Needs Signal Survey</strong> is a quick "would you rather" style quiz that helps you
                  discover which needs come forward most strongly when you're asked to choose.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:8px; background-color:#0d9488;">
                      <a href="${inviteUrl}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                        Start the Survey
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  Once you're done, you'll get your own personalized report to explore.
                </p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  See you on the other side of the signals!
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
    subject: `${test ? `[TEST${testParticipantLabel ? ` for ${testParticipantLabel}` : ""}] ` : ""}You're invited to the Needs Signal Survey 🚀`,
    bcc: test ? undefined : NOVA_APP_EMAIL,
    html,
  });
}
