import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTeamInvite } from "@/lib/nss/teamInvite";
import { sendTeamInviteEmail } from "@/lib/nss/teamInviteEmail";

// Admin-only — sends a pilot/team member their invite. Separate from
// /api/nss/lead-signup on purpose: that route is public (anyone can call it
// from the landing page), this one creates real accounts on an admin's say-so
// and must not be reachable by an unauthenticated caller.
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { firstName, lastName, email, team, managerEmail, managerFirstName } = await request.json();
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !team?.trim() || !managerEmail?.trim()) {
    return NextResponse.json(
      { error: "First name, last name, email, team, and manager email are required" },
      { status: 400 },
    );
  }

  try {
    const invite = await createTeamInvite({
      firstName,
      lastName,
      email,
      team: team.trim(),
      managerEmail: managerEmail.trim(),
    });

    const inviteUrl = `${origin}/team-invite?token=${invite.hashedToken}`;
    await sendTeamInviteEmail({
      to: invite.email,
      firstName: firstName.trim(),
      managerFirstName: (managerFirstName || "Your manager").trim(),
      inviteUrl,
      logoUrl: `${origin}/logo/bgb-line-almond.png`,
    });

    return NextResponse.json({ sent: true, isNewAccount: invite.isNewAccount });
  } catch (error) {
    console.error("[team-invite] failed:", error);
    return NextResponse.json({ error: "Could not send invite. Please try again." }, { status: 500 });
  }
}
