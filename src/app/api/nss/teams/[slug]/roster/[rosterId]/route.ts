import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { removeRosterEntry } from "@/lib/nss/teams";

// Removes one roster row. If it was already invited, also deletes the real
// account that invite created — see removeRosterEntry for why that's the
// only place that account can be found and cleaned up from.
export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string; rosterId: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { rosterId } = await params;

  try {
    const result = await removeRosterEntry(rosterId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[teams/roster/delete] failed:", error);
    return NextResponse.json({ error: "Could not remove that person. Please try again." }, { status: 500 });
  }
}
