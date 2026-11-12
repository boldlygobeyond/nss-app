import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { removeRosterEntry, setRosterAttendance } from "@/lib/nss/teams";

// Toggles "Attended See the Signals" — the launch prerequisite checked by
// the NSS/NRS invite routes before a real send.
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; rosterId: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { rosterId } = await params;
  const { attended } = await request.json();
  if (typeof attended !== "boolean") {
    return NextResponse.json({ error: "attended must be a boolean" }, { status: 400 });
  }

  try {
    await setRosterAttendance(rosterId, attended);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[teams/roster/patch] failed:", error);
    return NextResponse.json({ error: "Could not update attendance. Please try again." }, { status: 500 });
  }
}

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
    if (error instanceof Error && error.message === "NRS_HISTORY_BLOCKS_REMOVAL") {
      return NextResponse.json(
        {
          error:
            "Can't remove — this person has Needs Resonance Scan history. Remove their NRS data first if you really need to remove them.",
        },
        { status: 409 },
      );
    }
    console.error("[teams/roster/delete] failed:", error);
    return NextResponse.json({ error: "Could not remove that person. Please try again." }, { status: 500 });
  }
}
