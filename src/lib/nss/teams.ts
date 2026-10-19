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

export async function createTeam(name: string, rows: RosterRow[]): Promise<{ slug: string }> {
  const admin = createAdminClient();
  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let n = 2; ; n++) {
    const { data: existing } = await admin.from("teams").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${n}`;
  }

  const { error } = await admin.from("teams").insert({ name: name.trim(), slug });
  if (error) throw error;

  await addRosterRows(slug, rows);
  return { slug };
}

export async function addRosterRows(teamSlug: string, rows: RosterRow[]): Promise<void> {
  if (rows.length === 0) return;
  const admin = createAdminClient();
  const { data: team, error: teamError } = await admin
    .from("teams")
    .select("id")
    .eq("slug", teamSlug)
    .maybeSingle();
  if (teamError || !team) throw teamError ?? new Error("Team not found");

  // Upsert, not insert — re-uploading a corrected sheet updates existing
  // rows instead of erroring on the unique(team_id, email) constraint, and
  // only the columns listed here are touched, so invited_at on an
  // already-invited person is never reset back to null by a re-upload.
  const { error } = await admin.from("team_roster").upsert(
    rows.map((r) => ({
      team_id: team.id,
      first_name: r.firstName,
      last_name: r.lastName,
      email: r.email,
      manager_email: r.managerEmail,
    })),
    { onConflict: "team_id,email" },
  );
  if (error) throw error;
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
