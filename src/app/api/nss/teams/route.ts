import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createTeam } from "@/lib/nss/teams";
import type { RosterRow } from "@/lib/nss/rosterCsv";

// Creates a new team and its initial roster in one step — the CSV is
// parsed client-side (so the admin sees validation errors before
// submitting); this route just takes the already-parsed rows.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { name, rows } = (await request.json()) as { name?: string; rows?: RosterRow[] };
  if (!name?.trim() || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "A team name and at least one roster row are required" }, { status: 400 });
  }

  try {
    const { slug } = await createTeam(name, rows);
    return NextResponse.json({ slug });
  } catch (error) {
    console.error("[teams] create failed:", error);
    return NextResponse.json({ error: "Could not create the team. Please try again." }, { status: 500 });
  }
}
