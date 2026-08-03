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

export async function isManager(supabase: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id")
    .ilike("manager_email", email)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function updateProfile(
  supabase: SupabaseClient,
  id: string,
  fields: Partial<Pick<UserProfile, "first_name" | "last_name" | "manager_email" | "role">>,
): Promise<void> {
  const { error } = await supabase.from("user_profiles").update(fields).eq("id", id);
  if (error) throw error;
}
