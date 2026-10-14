// Sends the respondent their completed Needs Signal Report via Resend: an
// HTML email with the logo and a token-gated download link (see
// report-pdf-download route) — deliberately NOT also attached. The link is
// the tracking signal (pdf_downloaded_at is set when it's clicked); if the
// PDF were attached too, most recipients would just open that instead and
// the link — the thing we actually want a read on — would rarely get
// clicked. A link click is also a far more reliable "they got it" signal
// than an email-open pixel, which Apple Mail Privacy Protection and various
// client image proxies fire regardless of whether a human looked.
//
// Resend's own open/click tracking (toggled in the domain settings) covers
// the looser "did it land / did they engage at all" signal as a complement
// — pulled back into our own data via the resend-webhook route, tagged
// here with the submission id so that webhook can correlate an event back
// to a row without needing to look up or store Resend's own email id.
export async function sendRespondentReportEmail(params: {
  to: string;
  firstName: string;
  submissionId: string;
  downloadUrl: string;
  logoUrl: string;
}): Promise<void> {
  const { to, firstName, submissionId, downloadUrl, logoUrl } = params;

  // Read at call time, not module load — a plain env var (not NEXT_PUBLIC_,
  // server-only) so the booking link can change without a redeploy, and so
  // it's picked up correctly regardless of when this module was imported
  // relative to when the environment was populated.
  const CALENDAR_BOOKING_URL = process.env.CALENDAR_BOOKING_URL;
  if (!CALENDAR_BOOKING_URL) {
    console.error("[respondent-email] CALENDAR_BOOKING_URL not set, skipping send");
    return;
  }

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
                  Thanks for completing the Boldly Go Beyond <strong>Needs Signal Survey</strong>.
                  Your personalized <strong>Needs Signal Report</strong> is ready, giving you a
                  snapshot of what you need to thrive at work right now.
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

                <p style="margin:0 0 28px; font-size:15px; line-height:1.6; color:#374151;">
                  Inside, you'll find insights into your needs, signals to pay attention to,
                  and questions to help you turn awareness into action.
                </p>

                <hr style="border:none; border-top:1px solid #e5e7eb; margin:0 0 28px;" />

                <p style="margin:0 0 16px; font-size:16px; font-weight:600; color:#111827;">
                  Now imagine having that same visibility across your entire team.
                </p>

                <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#374151;">
                  When you understand what your people need to do their best work, you can
                  move beyond guesswork, reduce the burden on managers, and empower your crew
                  to take greater ownership of their success.
                </p>

                <p style="margin:0 0 16px; font-size:16px; font-weight:600; color:#111827;">
                  Ready to see what your team's signals could reveal?
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                  <tr>
                    <td style="border-radius:8px; background-color:#0a0e17;">
                      <a href="${CALENDAR_BOOKING_URL}" style="display:inline-block; padding:12px 24px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                        📅 Let's Decode Your Signals
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 28px; font-size:14px; line-height:1.6; color:#6b7280;">
                  Prefer to start by email? Just hit reply. We'd love to hear what stood out
                  in your report.
                </p>

                <p style="margin:0 0 4px; font-size:14px; line-height:1.6; color:#374151;">Best,</p>
                <p style="margin:0 0 2px; font-size:14px; font-weight:600; color:#111827;">Marc Chiu</p>
                <p style="margin:0 0 20px; font-size:13px; color:#6b7280;">Founder &amp; CEO | Boldly Go Beyond</p>
                <p style="margin:0 0 6px; font-size:13px; font-style:italic; color:#6b7280;">See the signals. Decode the system. Unlock what&rsquo;s possible.</p>
                <p style="margin:0 0 32px; font-size:13px;">
                  <a href="https://boldlygobeyond.com?utm_source=NSS_report&amp;utm_medium=email&amp;utm_campaign=NSS_Report_Email&amp;utm_id=NSS" style="color:#0d9488; text-decoration:none;">www.boldlygobeyond.com</a>
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

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Marc @ Boldly Go Beyond <first.contact@boldlygobeyond.com>",
        to,
        subject: "Your Needs Signal Report is ready 🚀",
        html,
        tags: [{ name: "submission_id", value: submissionId }],
      }),
    });
    if (!res.ok) {
      console.error("[respondent-email] send failed:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[respondent-email] send error:", error);
  }
}
