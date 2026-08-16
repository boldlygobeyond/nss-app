import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Instant passwordless signup for the public landing page's lead-capture
// modal — trades the usual "click the link in your email" round trip for an
// immediate session, so a brand-new lead lands straight in the survey.
//
// If the email already has an account, we deliberately do NOT grant instant
// access — generateLink() would happily hand back a valid session for any
// existing email with zero proof the submitter actually owns it, which is an
// account-takeover hole (anyone who knows a colleague's work email could log
// in as them). Existing accounts get routed back through a real magic-link
// email instead, same as the normal login flow.
export async function POST(request: Request) {
  const { firstName, lastName, email, leadSource } = await request.json();

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "First name, last name, and email are required" }, { status: 400 });
  }

  const trimmedEmail = email.trim();
  const supabase = createAdminClient();

  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("email", trimmedEmail)
    .maybeSingle();

  if (existingProfile) {
    return NextResponse.json({ existingAccount: true, email: trimmedEmail });
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: trimmedEmail,
    options: {
      data: {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        lead_source: leadSource || null,
      },
    },
  });

  if (error || !data.properties?.hashed_token) {
    console.error("[lead-signup] generateLink failed:", error);
    return NextResponse.json({ error: "Could not start your assessment. Please try again." }, { status: 500 });
  }

  // The handle_new_user trigger only copies first_name out of auth metadata
  // into user_profiles, not last_name — so every signup was silently ending
  // up with a blank last name despite it being collected right here. Fill
  // it in directly rather than relying on the trigger for the full name.
  const { error: nameError } = await supabase
    .from("user_profiles")
    .update({ first_name: firstName.trim(), last_name: lastName.trim() })
    .eq("id", data.user.id);
  if (nameError) console.warn("[lead-signup] Failed to backfill name on profile:", nameError);

  return NextResponse.json({ existingAccount: false, email: trimmedEmail, tokenHash: data.properties.hashed_token });
}
