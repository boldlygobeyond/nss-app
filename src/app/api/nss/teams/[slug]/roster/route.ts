import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { addRosterRows } from "@/lib/nss/teams";
import type { RosterRow } from "@/lib/nss/rosterCsv";

// Adds more people to an existing team's roster (upserts — see
// addRosterRows for why a re-upload is safe).
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { slug } = await params;
  const { rows, folderId, spreadsheetId } = (await request.json()) as {
    rows?: RosterRow[];
    folderId?: string | null;
    spreadsheetId?: string | null;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "At least one roster row is required" }, { status: 400 });
  }

  try {
    await addRosterRows(slug, rows, { folderId: folderId ?? null, spreadsheetId: spreadsheetId ?? null });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[teams/roster] add failed:", error);
    return NextResponse.json({ error: "Could not add to the roster. Please try again." }, { status: 500 });
  }
}
