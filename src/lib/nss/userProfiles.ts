import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  manager_email: string | null;
  role: "user" | "admin";
  lead_source: string | null;
}

export async function getMyProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as UserProfile | null;
}

export async function listAllProfiles(supabase: SupabaseClient): Promise<UserProfile[]> {
  const { data, error } = await supabase.from("user_profiles").select("*").order("email");
  if (error) throw error;
  return data as UserProfile[];
}

export interface TeamProfile {
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export async function listTeamProfiles(supabase: SupabaseClient, managerEmail: string): Promise<TeamProfile[]> {
  // Same RLS gap as isManager() — a non-admin manager can't read other
  // people's user_profiles rows via a plain select, so this goes through a
  // dedicated security-definer RPC scoped to just email/first_name/last_name.
  const { data, error } = await supabase.rpc("get_team_profiles", { root_email: managerEmail });
  if (error) throw error;
  return (data ?? []) as TeamProfile[];
}

export async function isManager(supabase: SupabaseClient, email: string): Promise<boolean> {
  // A raw filtered select against user_profiles here would only ever
  // return rows the caller already has RLS access to — i.e. their own row
  // or, if they're an admin, everyone's. For a real, non-admin manager
  // that's always zero rows regardless of what manager_email says, so this
  // goes through the same security-definer pattern as get_subordinate_emails.
  const { data, error } = await supabase.rpc("is_manager", { check_email: email });
  if (error) throw error;
  return !!data;
}

export async function updateProfile(
  supabase: SupabaseClient,
  id: string,
  fields: Partial<Pick<UserProfile, "first_name" | "last_name" | "manager_email" | "role">>,
): Promise<void> {
  const { error } = await supabase.from("user_profiles").update(fields).eq("id", id);
  if (error) throw error;
}
