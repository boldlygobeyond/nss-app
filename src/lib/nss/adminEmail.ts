import { sendNssEmail, type NssSendOutcome } from "./emailSend";

const ADMIN_RECIPIENT = "nova.app@boldlygobeyond.com";

// Internal admin notification — informational only, never blocks whatever
// request triggered it. Routes through the shared sendNssEmail() choke
// point like every other NSS email now does, so it's covered by the same
// NSS_EMAIL_MODE dev-safety gate and the same outcome the caller can log
// to nss_send_log, instead of this function swallowing its own errors.
export async function sendAdminEmail(subject: string, text: string): Promise<NssSendOutcome> {
  return sendNssEmail({
    from: "Boldly Go Beyond Diagnostics <first.contact@boldlygobeyond.com>",
    to: ADMIN_RECIPIENT,
    subject,
    text,
  });
}

export { ADMIN_RECIPIENT };
