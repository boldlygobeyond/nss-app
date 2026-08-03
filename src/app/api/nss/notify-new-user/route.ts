import { NextResponse } from "next/server";

// Hit by a Supabase Database Webhook on INSERT into public.user_profiles —
// i.e. exactly once per person, the moment they first sign in. Guarded by a
// shared secret since this URL is otherwise unauthenticated and public.
export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");
  if (!process.env.NSS_WEBHOOK_SECRET || secret !== process.env.NSS_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const record = payload?.record;
  if (!record?.email) {
    return NextResponse.json({ error: "missing record" }, { status: 400 });
  }

  const lines = [
    "A new user just signed in for the first time.",
    "",
    `Email: ${record.email}`,
    record.first_name ? `First name: ${record.first_name}` : null,
    record.lead_source ? `Lead source: ${record.lead_source}` : null,
  ].filter(Boolean);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Boldly Go Beyond Diagnostics <first.contact@boldlygobeyond.com>",
      to: "nova.app@boldlygobeyond.com",
      subject: "New Diagnostics sign-up",
      text: lines.join("\n"),
    }),
  });

  if (!res.ok) {
    console.error("[notify-new-user] Resend send failed:", await res.text());
  }

  return NextResponse.json({ ok: true });
}
