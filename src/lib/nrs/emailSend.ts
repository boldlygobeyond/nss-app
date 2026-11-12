// Single choke point every NRS email template sends through — new
// relative to NSS, which has no shared wrapper at all (its 4 email files
// each duplicate their own fetch() call to Resend). This is also where
// NRS's dev-safety guard lives: NRS_EMAIL_MODE defaults to "mock"
// whenever NODE_ENV !== "production", so local dev and any non-production
// deploy never call Resend for an NRS email unless NRS_EMAIL_MODE=live is
// explicitly set in that environment. This only affects these 3 NRS email
// functions — NSS's existing email behavior is untouched.
export type NrsSendOutcome =
  | { outcome: "sent"; resendMessageId: string | null }
  | { outcome: "mocked" }
  | { outcome: "failed"; errorMessage: string };

function sendMode(): "mock" | "live" {
  const explicit = process.env.NRS_EMAIL_MODE;
  if (explicit === "live" || explicit === "mock") return explicit;
  return process.env.NODE_ENV === "production" ? "live" : "mock";
}

export async function sendNrsEmail(payload: {
  from: string;
  to: string;
  subject: string;
  html: string;
  bcc?: string;
  tag: { name: string; value: string };
}): Promise<NrsSendOutcome> {
  if (sendMode() === "mock") {
    console.log("[nrs-email-mock]", { to: payload.to, subject: payload.subject, bcc: payload.bcc, tag: payload.tag });
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
        html: payload.html,
        ...(payload.bcc ? { bcc: payload.bcc } : {}),
        tags: [payload.tag],
      }),
    });
    if (!res.ok) {
      const errorMessage = `${res.status} ${await res.text()}`;
      console.error("[nrs-email] send failed:", errorMessage);
      return { outcome: "failed", errorMessage };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { outcome: "sent", resendMessageId: data.id ?? null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[nrs-email] send error:", errorMessage);
    return { outcome: "failed", errorMessage };
  }
}
