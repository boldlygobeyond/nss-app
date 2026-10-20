import { createAdminClient } from "@/lib/supabase/admin";
import type { RosterRow } from "./rosterCsv";

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team"
  );
}

export interface DriveSource {
  folderId: string | null;
  spreadsheetId: string | null;
}

export async function createTeam(name: string, rows: RosterRow[], drive?: DriveSource): Promise<{ slug: string }> {
  const admin = createAdminClient();
  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let n = 2; ; n++) {
    const { data: existing } = await admin.from("teams").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${n}`;
  }

  const { error } = await admin.from("teams").insert({
    name: name.trim(),
    slug,
    drive_folder_id: drive?.folderId ?? null,
    drive_spreadsheet_id: drive?.spreadsheetId ?? null,
  });
  if (error) throw error;

  await addRosterRows(slug, rows, drive);
  return { slug };
}

// Only called from createTeam now — the standalone "add more people by
// picking another sheet" admin action was removed once resync covered the
// same need (new rows in the same tracked sheet) more consistently.
async function addRosterRows(teamSlug: string, rows: RosterRow[], drive?: DriveSource): Promise<void> {
  const admin = createAdminClient();
  const { data: team, error: teamError } = await admin
    .from("teams")
    .select("id, drive_folder_id, drive_spreadsheet_id")
    .eq("slug", teamSlug)
    .maybeSingle();
  if (teamError || !team) throw teamError ?? new Error("Team not found");

  // First Drive-sourced pick wins — if a team's folder/sheet aren't set yet
  // and someone adds to the roster by picking from Drive, that becomes the
  // team's reports folder and resync source. If one's already set, a later
  // pick never silently redirects where reports land or what resync reads.
  if (drive?.folderId && !team.drive_folder_id) {
    await admin
      .from("teams")
      .update({ drive_folder_id: drive.folderId, drive_spreadsheet_id: drive.spreadsheetId })
      .eq("id", team.id);
  }

  if (rows.length === 0) return;

  // Upsert, not insert — re-uploading a corrected sheet updates existing
  // rows instead of erroring on the unique(team_id, email) constraint, and
  // only the columns listed here are touched, so invited_at on an
  // already-invited person is never reset back to null by a re-upload.
  // missing_from_sheet resets to false here too — a row touched by a fresh
  // read is, by definition, currently in the sheet.
  const { error } = await admin.from("team_roster").upsert(
    rows.map((r) => ({
      team_id: team.id,
      first_name: r.firstName,
      last_name: r.lastName,
      email: r.email,
      manager_email: r.managerEmail,
      missing_from_sheet: false,
    })),
    { onConflict: "team_id,email" },
  );
  if (error) throw error;
}

// "The spreadsheet is the source of truth" — re-reads it and reconciles:
// rows matching an email already on the roster get their name/manager
// updated, new emails get added, and roster rows whose email no longer
// appears get flagged (never deleted — someone might already have a real
// account from an earlier invite under that row, which a resync has no
// business removing).
export async function resyncRosterFromSheet(
  teamSlug: string,
  rows: RosterRow[],
  folderId?: string | null,
): Promise<{ added: number; updated: number; missing: number }> {
  const admin = createAdminClient();
  const { data: team, error: teamError } = await admin
    .from("teams")
    .select("id, drive_folder_id")
    .eq("slug", teamSlug)
    .maybeSingle();
  if (teamError || !team) throw teamError ?? new Error("Team not found");

  // Backfill a folder id that failed to capture on the original pick (see
  // fetchParentFolderId in googlePicker.ts) — this is the only other place
  // a team's folder can get set now that "add more people" is gone, so a
  // team stuck without one would otherwise have no way to recover it.
  if (folderId && !team.drive_folder_id) {
    await admin.from("teams").update({ drive_folder_id: folderId }).eq("id", team.id);
  }

  const { data: existingRows } = await admin.from("team_roster").select("email").eq("team_id", team.id);
  const existingEmails = new Set((existingRows ?? []).map((r) => r.email));
  const sheetEmails = new Set(rows.map((r) => r.email));

  const added = rows.filter((r) => !existingEmails.has(r.email)).length;
  const updated = rows.length - added;

  if (rows.length > 0) {
    const { error } = await admin.from("team_roster").upsert(
      rows.map((r) => ({
        team_id: team.id,
        first_name: r.firstName,
        last_name: r.lastName,
        email: r.email,
        manager_email: r.managerEmail,
        missing_from_sheet: false,
      })),
      { onConflict: "team_id,email" },
    );
    if (error) throw error;
  }

  const missingEmails = [...existingEmails].filter((e) => !sheetEmails.has(e));
  if (missingEmails.length > 0) {
    await admin.from("team_roster").update({ missing_from_sheet: true }).eq("team_id", team.id).in("email", missingEmails);
  }

  return { added, updated, missing: missingEmails.length };
}

// Removes a roster row — typically used to clear out a stale entry flagged
// "Not in sheet" (e.g. after an email typo correction created a fresh row
// for the corrected address). If this row was already invited, a real
// account exists under its email independent of this table; that account
// is also deleted here, since otherwise there'd be no way to find or clean
// it up from the workspace at all. Returns whether an account was found
// and removed, so the caller can tell the admin what actually happened.
export async function removeRosterEntry(rosterId: string): Promise<{ accountDeleted: boolean }> {
  const admin = createAdminClient();
  const { data: entry, error: entryError } = await admin
    .from("team_roster")
    .select("email, invited_at")
    .eq("id", rosterId)
    .maybeSingle();
  if (entryError || !entry) throw entryError ?? new Error("Roster entry not found");

  const { error: deleteError } = await admin.from("team_roster").delete().eq("id", rosterId);
  if (deleteError) throw deleteError;

  if (!entry.invited_at) return { accountDeleted: false };

  const { data: profile } = await admin.from("user_profiles").select("id").eq("email", entry.email).maybeSingle();
  if (!profile) return { accountDeleted: false };

  const { error: authError } = await admin.auth.admin.deleteUser(profile.id);
  if (authError) throw authError;
  return { accountDeleted: true };
}

// Used so the invite-send step never has to ask for the manager's first
// name separately: check whether the manager is themselves a row in this
// team's roster first (most common case — the manager is on the same
// sheet), then fall back to an existing account if they've logged in
// before under a different team.
export async function resolveManagerFirstName(teamSlug: string, managerEmail: string): Promise<string | null> {
  const admin = createAdminClient();
  const lowerEmail = managerEmail.toLowerCase();

  const { data: team } = await admin.from("teams").select("id").eq("slug", teamSlug).maybeSingle();
  if (team) {
    const { data: rosterMatch } = await admin
      .from("team_roster")
      .select("first_name")
      .eq("team_id", team.id)
      .eq("email", lowerEmail)
      .maybeSingle();
    if (rosterMatch?.first_name) return rosterMatch.first_name;
  }

  const { data: profileMatch } = await admin
    .from("user_profiles")
    .select("first_name")
    .eq("email", lowerEmail)
    .maybeSingle();
  return profileMatch?.first_name ?? null;
}
