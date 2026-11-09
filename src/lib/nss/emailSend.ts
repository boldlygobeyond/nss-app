// Single choke point every NSS email template sends through — mirrors
// src/lib/nrs/emailSend.ts. Before this, NSS's 4 email files each
// duplicated their own fetch() call to Resend, swallowed any error
// internally (console.error only — the caller never learned whether the
// email actually sent), and had no dev-safety gate at all, unlike NRS.
// This is also where that gate now lives: NSS_EMAIL_MODE defaults to
// "mock" whenever NODE_ENV !== "production", so local dev and any
// non-production deploy never call Resend for an NSS email unless
// NSS_EMAIL_MODE=live is explicitly set in that environment — same
// semantics as NRS_EMAIL_MODE.
export type NssSendOutcome =
  | { outcome: "sent"; resendMessageId: string | null }
  | { outcome: "mocked" }
  | { outcome: "failed"; errorMessage: string };

function sendMode(): "mock" | "live" {
  const explicit = process.env.NSS_EMAIL_MODE;
  if (explicit === "live" || explicit === "mock") return explicit;
  return process.env.NODE_ENV === "production" ? "live" : "mock";
}

// html XOR text — adminEmail.ts sends plain text (an internal
// notification, never styled HTML); the other 3 send HTML. Resend's own
// API takes either.
type EmailBody = { html: string; text?: never } | { text: string; html?: never };

export async function sendNssEmail(
  payload: {
    from: string;
    to: string;
    subject: string;
    tag?: { name: string; value: string };
  } & EmailBody,
): Promise<NssSendOutcome> {
  if (sendMode() === "mock") {
    console.log("[nss-email-mock]", { to: payload.to, subject: payload.subject, tag: payload.tag });
    return { outcome: "mocked" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        ...("html" in payload && payload.html ? { html: payload.html } : { text: payload.text }),
        ...(payload.tag ? { tags: [payload.tag] } : {}),
      }),
    });
    if (!res.ok) {
      const errorMessage = `${res.status} ${await res.text()}`;
      console.error("[nss-email] send failed:", errorMessage);
      return { outcome: "failed", errorMessage };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { outcome: "sent", resendMessageId: data.id ?? null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[nss-email] send error:", errorMessage);
    return { outcome: "failed", errorMessage };
  }
}
