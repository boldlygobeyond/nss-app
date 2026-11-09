import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeamInvite } from "@/lib/nss/teamInvite";
import { sendTeamInviteEmail } from "@/lib/nss/teamInviteEmail";
import { logNssSend } from "@/lib/nss/sendLog";
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

    // Looked up before sending so the send-log row can be tied to the
    // right roster entry regardless of outcome — a roster row may not
    // exist at all (the one-off invite form doesn't create one), which is
    // fine; logNssSend's rosterId is optional for exactly this case.
    const adminClient = createAdminClient();
    const { data: teamRow } = await adminClient.from("teams").select("id").eq("slug", trimmedTeam).maybeSingle();
    const { data: rosterRow } = teamRow
      ? await adminClient
          .from("team_roster")
          .select("id")
          .eq("team_id", teamRow.id)
          .eq("email", invite.email)
          .maybeSingle()
      : { data: null };

    const inviteUrl = `${origin}/team-invite?token=${invite.hashedToken}`;
    const sendResult = await sendTeamInviteEmail({
      to: invite.email,
      firstName: firstName.trim(),
      managerFirstName: resolvedManagerFirstName,
      inviteUrl,
      logoUrl: `${origin}/logo/bgb-line-almond.png`,
    });
    await logNssSend({
      recipientEmail: invite.email,
      emailType: "team_invite",
      outcome: sendResult,
      rosterId: rosterRow?.id ?? null,
      sentBy: admin.userId,
    });

    // Best-effort — stamps the roster row so the workspace shows this
    // person as invited, independent of whether the email itself
    // succeeded (the roster's own "Invited" status has always meant "an
    // invite was triggered," not "the email definitely arrived" — the
    // new per-row beacon on the Invites tab is what actually answers
    // that now).
    if (rosterRow) {
      await adminClient
        .from("team_roster")
        .update({ invited_at: new Date().toISOString() })
        .eq("id", rosterRow.id);
    }

    return NextResponse.json({ outcome: sendResult.outcome, isNewAccount: invite.isNewAccount });
  } catch (error) {
    console.error("[team-invite] failed:", error);
    return NextResponse.json({ error: "Could not send invite. Please try again." }, { status: 500 });
  }
}
