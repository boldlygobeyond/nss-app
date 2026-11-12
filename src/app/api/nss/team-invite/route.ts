import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTeamInvite } from "@/lib/nss/teamInvite";
import { sendTeamInviteEmail } from "@/lib/nss/teamInviteEmail";
import { logNssSend } from "@/lib/nss/sendLog";
import { getAdminTestEmail } from "@/lib/internalEmail";
import { fakePreviewToken } from "@/lib/previewToken";

// Admin-only — sends a pilot/team member their invite. Separate from
// /api/nss/lead-signup on purpose: that route is public (anyone can call it
// from the landing page), this one creates real accounts on an admin's say-so
// and must not be reachable by an unauthenticated caller.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { origin } = new URL(request.url);
  const { firstName, lastName, email, team, managerEmail, test } = await request.json();
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !team?.trim() || !managerEmail?.trim()) {
    return NextResponse.json(
      { error: "First name, last name, email, team, and manager email are required" },
      { status: 400 },
    );
  }

  // Test sends preview the real, personalized email without touching any
  // real state: no Supabase Auth account is created (createTeamInvite is
  // skipped entirely), no roster stamp, no send-log row. The link is a
  // fake, never-persisted token in the same shape as a real one — it
  // 404s if clicked, so a tester can never act on this participant's
  // behalf.
  if (test === true) {
    const inviteUrl = `${origin}/team-invite?token=${fakePreviewToken()}`;
    const sendResult = await sendTeamInviteEmail({
      to: getAdminTestEmail(),
      firstName: firstName.trim(),
      inviteUrl,
      logoUrl: `${origin}/logo/bgb-line-almond.png`,
      test: true,
      testParticipantLabel: `${firstName.trim()} ${lastName.trim()}`,
    });
    return NextResponse.json({ outcome: sendResult.outcome });
  }

  try {
    const trimmedTeam = team.trim();
    const trimmedManagerEmail = managerEmail.trim();

    // Looked up before creating the invite (not just before sending, as
    // before) so the launch-prerequisite gate below can run first — a
    // roster row may not exist at all (the one-off invite form doesn't
    // create one), in which case there's nothing to gate against and this
    // falls through to a normal send, same as always.
    const adminClient = createAdminClient();
    const { data: teamRow } = await adminClient.from("teams").select("id").eq("slug", trimmedTeam).maybeSingle();
    const { data: rosterRow } = teamRow
      ? await adminClient
          .from("team_roster")
          .select("id, attended_see_the_signals_at")
          .eq("team_id", teamRow.id)
          .eq("email", email.trim().toLowerCase())
          .maybeSingle()
      : { data: null };

    if (rosterRow && !rosterRow.attended_see_the_signals_at) {
      return NextResponse.json(
        { error: "This person hasn't attended See the Signals yet — check them off on the Roster tab first." },
        { status: 400 },
      );
    }

    const invite = await createTeamInvite({
      firstName,
      lastName,
      email,
      team: trimmedTeam,
      managerEmail: trimmedManagerEmail,
    });

    const inviteUrl = `${origin}/team-invite?token=${invite.hashedToken}`;
    const sendResult = await sendTeamInviteEmail({
      to: invite.email,
      firstName: firstName.trim(),
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
