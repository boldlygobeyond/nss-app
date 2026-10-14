import { NextResponse, after } from "next/server";
import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { notifyCrmLead } from "@/lib/nss/crm";

// Resend sends email.opened/email.clicked (among other event types) here
// for every email this app sends — including the admin notification and
// any other non-report email, which won't carry our submission_id tag and
// are silently ignored below. Signed with Svix; payload must stay the raw
// request body (parsing and re-stringifying breaks the signature), so this
// reads request.text() rather than request.json().
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const payload = await request.text();
  const svixHeaders = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  type ResendWebhookEvent = { type?: string; data?: { tags?: Record<string, string> } };
  // verify() only validates the signature (throws on failure) — this
  // version of the svix package always returns undefined on success
  // (it's called internally with jsonParse: false), so the payload has to
  // be parsed separately after a successful verify, not taken from the
  // return value.
  try {
    new Webhook(secret).verify(payload, svixHeaders);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(payload) as ResendWebhookEvent;

  const eventType = event.type;
  if (eventType !== "email.opened" && eventType !== "email.clicked") {
    // Not a signal we track (delivered, bounced, etc.) — ack and ignore.
    return NextResponse.json({ ok: true });
  }

  const submissionId = event.data?.tags?.submission_id;
  if (!submissionId) {
    // Not one of our tagged report emails (e.g. the internal admin
    // notification, which isn't tagged) — nothing to correlate this to.
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const selectColumn = eventType === "email.opened" ? "email_opened_at" : "email_clicked_at";
  const { data: submission } = await admin
    .from("nss_submissions")
    .select(`id, user_id, user_email, respondent_name, ${selectColumn}`)
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) {
    return NextResponse.json({ ok: true });
  }

  // nss_submissions keeps first-touch only (when this was FIRST opened or
  // clicked, unchanged below) — but the CRM gets notified on every event,
  // not just the first, since a lead re-opening or re-clicking later is
  // itself the "still engaged" signal worth surfacing there.
  const alreadyTouched =
    eventType === "email.opened"
      ? Boolean((submission as { email_opened_at?: string }).email_opened_at)
      : Boolean((submission as { email_clicked_at?: string }).email_clicked_at);
  const touchedAt = new Date().toISOString();
  if (!alreadyTouched) {
    await admin
      .from("nss_submissions")
      .update(eventType === "email.opened" ? { email_opened_at: touchedAt } : { email_clicked_at: touchedAt })
      .eq("id", submissionId)
      .is(selectColumn, null);
  }

  if (submission.user_email) {
    const profile = await getMyProfile(admin, submission.user_id).catch(() => null);
    const firstName = profile?.first_name || (submission.respondent_name as string).split(" ")[0];
    const lastName = profile?.last_name || "";
    const email = submission.user_email as string;
    after(() =>
      notifyCrmLead({
        firstName,
        lastName,
        email,
        ...(eventType === "email.opened"
          ? { reportEmailOpenedAt: touchedAt }
          : { reportEmailClickedAt: touchedAt }),
      }).catch((crmError) => console.warn("[resend-webhook] CRM notify failed:", crmError)),
    );
  }

  return NextResponse.json({ ok: true });
}
