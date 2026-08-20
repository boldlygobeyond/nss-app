import { NextResponse } from "next/server";
import { notifyCrmLead } from "@/lib/nss/crm";
import { sendAdminEmail } from "@/lib/nss/adminEmail";

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

  const fullName = [record.first_name, record.last_name].filter(Boolean).join(" ");

  const lines = [
    "A new user just signed in for the first time.",
    "",
    `Email: ${record.email}`,
    fullName ? `Name: ${fullName}` : null,
    record.lead_source ? `Lead source: ${record.lead_source}` : null,
  ].filter(Boolean);

  await Promise.allSettled([
    sendAdminEmail("New Diagnostics sign-up", lines.join("\n")),
    notifyCrmLead({
      firstName: record.first_name ?? "",
      lastName: record.last_name ?? "",
      email: record.email,
      sourceParam: record.lead_source,
    }),
  ]);

  return NextResponse.json({ ok: true });
}
