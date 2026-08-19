import { NextResponse } from "next/server";

// Best-effort — CRM lead capture is a side effect of onboarding, not a
// requirement for it, so a slow/unreachable CRM must never fail the webhook
// (which would make Supabase retry it and re-send the admin email).
async function notifyCrm(record: {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  lead_source?: string | null;
}) {
  if (!process.env.CRM_LEAD_INTAKE_API_KEY) {
    console.warn("[notify-new-user] CRM_LEAD_INTAKE_API_KEY not set, skipping CRM lead intake");
    return;
  }
  try {
    const res = await fetch("https://crm.boldlygobeyond.com/api/leads/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CRM_LEAD_INTAKE_API_KEY,
      },
      body: JSON.stringify({
        firstName: record.first_name ?? "",
        lastName: record.last_name ?? "",
        email: record.email,
        ...(record.lead_source ? { sourceParam: record.lead_source } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[notify-new-user] CRM lead intake failed:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[notify-new-user] CRM lead intake error:", error);
  }
}

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

  const [emailResult] = await Promise.allSettled([
    fetch("https://api.resend.com/emails", {
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
    }),
    notifyCrm(record),
  ]);

  if (emailResult.status === "fulfilled" && !emailResult.value.ok) {
    console.error("[notify-new-user] Resend send failed:", await emailResult.value.text());
  } else if (emailResult.status === "rejected") {
    console.error("[notify-new-user] Resend send error:", emailResult.reason);
  }

  return NextResponse.json({ ok: true });
}
