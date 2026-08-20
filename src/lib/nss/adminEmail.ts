// Best-effort admin notification via Resend — informational only, never
// blocks whatever request triggered it.
export async function sendAdminEmail(subject: string, text: string): Promise<void> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Boldly Go Beyond Diagnostics <first.contact@boldlygobeyond.com>",
        to: "nova.app@boldlygobeyond.com",
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error("[admin-email] send failed:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[admin-email] send error:", error);
  }
}
