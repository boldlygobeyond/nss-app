import { createAdminClient } from "@/lib/supabase/admin";

// Pilot/team invites (e.g. the WI LGBT Chamber of Commerce pilot) — a
// parallel onboarding path to the public lead-capture funnel, not a
// replacement for it. Nothing here touches lead-signup, notifyCrmLead, or
// any code path the public landing page uses.
//
// admin.generateLink's own action_link can't be emailed directly: it
// redirects with tokens in the URL fragment, which this app's
// /auth/callback (a server route) can never read — fragments never reach
// the server. Instead this returns the raw hashed_token, so the invite
// email can link to our own /team-invite page, which calls verifyOtp()
// client-side — the exact mechanism LeadCaptureModal already uses
// successfully for instant lead signup, just triggered by an email click
// instead of a form submit.
export async function createTeamInvite(params: {
  firstName: string;
  lastName: string;
  email: string;
  team: string;
  managerEmail: string;
}): Promise<{ email: string; hashedToken: string; isNewAccount: boolean }> {
  const supabase = createAdminClient();
  const trimmedEmail = params.email.trim();

  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("email", trimmedEmail)
    .maybeSingle();

  // options.data only seeds metadata at account-creation time — Supabase
  // ignores it for an already-existing user, so there's no risk of a
  // resend silently overwriting someone's team/manager_email with stale
  // values from an earlier invite form submission.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: trimmedEmail,
    options: existingProfile
      ? undefined
      : {
          data: {
            first_name: params.firstName.trim(),
            last_name: params.lastName.trim(),
            team: params.team,
            manager_email: params.managerEmail,
          },
        },
  });

  if (error || !data?.properties?.hashed_token) {
    throw error ?? new Error("Could not generate invite link");
  }

  return { email: trimmedEmail, hashedToken: data.properties.hashed_token, isNewAccount: !existingProfile };
}
