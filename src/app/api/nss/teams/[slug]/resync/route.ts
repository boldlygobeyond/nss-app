import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { resyncRosterFromSheet } from "@/lib/nss/teams";
import type { RosterRow } from "@/lib/nss/rosterCsv";

// The sheet is read fresh client-side (same spreadsheet id stored on the
// team from the original pick — see fetchRosterGridForSpreadsheet) and
// parsed there; this route just reconciles the already-parsed rows against
// what's currently on the roster.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { slug } = await params;
  const { rows } = (await request.json()) as { rows?: RosterRow[] };
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Roster rows are required" }, { status: 400 });
  }

  try {
    const result = await resyncRosterFromSheet(slug, rows);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[teams/resync] failed:", error);
    return NextResponse.json({ error: "Could not resync from the sheet. Please try again." }, { status: 500 });
  }
}
