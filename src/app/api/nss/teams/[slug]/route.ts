import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { renameTeam } from "@/lib/nss/teams";

// Admin-only. Renames a team's display name. The slug in the URL
// identifies which team; it is never itself changed by this route — see
// renameTeam for why.
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { slug } = await params;
  const { name } = (await request.json()) as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "A team name is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: team } = await adminClient.from("teams").select("id").eq("slug", slug).maybeSingle();
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  try {
    await renameTeam(team.id, name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[teams/rename] failed:", error);
    return NextResponse.json({ error: "Could not rename the team. Please try again." }, { status: 500 });
  }
}
