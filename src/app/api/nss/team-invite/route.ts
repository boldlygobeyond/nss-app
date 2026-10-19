import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeamInvite } from "@/lib/nss/teamInvite";
import { sendTeamInviteEmail } from "@/lib/nss/teamInviteEmail";
import { resolveManagerFirstName } from "@/lib/nss/teams";

// Admin-only — sends a pilot/team member their invite. Separate from
// /api/nss/lead-signup on purpose: that route is public (anyone can call it
// from the landing page), this one creates real accounts on an admin's say-so
// and must not be reachable by an unauthenticated caller.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { origin } = new URL(request.url);
  const { firstName, lastName, email, team, managerEmail, managerFirstName } = await request.json();
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !team?.trim() || !managerEmail?.trim()) {
    return NextResponse.json(
      { error: "First name, last name, email, team, and manager email are required" },
      { status: 400 },
    );
  }

  try {
    const trimmedTeam = team.trim();
    const trimmedManagerEmail = managerEmail.trim();

    const invite = await createTeamInvite({
      firstName,
      lastName,
      email,
      team: trimmedTeam,
      managerEmail: trimmedManagerEmail,
    });

    // Caller can supply the manager's first name directly (the one-off
    // invite form does); the roster-driven flow doesn't collect it, so
    // resolve it from whoever else is on this team or already has an
    // account under that email.
    const resolvedManagerFirstName =
      (managerFirstName as string | undefined)?.trim() ||
      (await resolveManagerFirstName(trimmedTeam, trimmedManagerEmail)) ||
      "Your manager";

    const inviteUrl = `${origin}/team-invite?token=${invite.hashedToken}`;
    await sendTeamInviteEmail({
      to: invite.email,
      firstName: firstName.trim(),
      managerFirstName: resolvedManagerFirstName,
      inviteUrl,
      logoUrl: `${origin}/logo/bgb-line-almond.png`,
    });

    // Best-effort — stamps the roster row so the workspace shows this
    // person as invited. A roster row may not exist (the one-off invite
    // form doesn't create one), so this is allowed to match nothing.
    const adminClient = createAdminClient();
    const { data: teamRow } = await adminClient.from("teams").select("id").eq("slug", trimmedTeam).maybeSingle();
    if (teamRow) {
      await adminClient
        .from("team_roster")
        .update({ invited_at: new Date().toISOString() })
        .eq("team_id", teamRow.id)
        .eq("email", invite.email);
    }

    return NextResponse.json({ sent: true, isNewAccount: invite.isNewAccount });
  } catch (error) {
    console.error("[team-invite] failed:", error);
    return NextResponse.json({ error: "Could not send invite. Please try again." }, { status: 500 });
  }
}
