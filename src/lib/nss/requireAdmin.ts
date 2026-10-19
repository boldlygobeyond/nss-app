import { createClient } from "@/lib/supabase/server";

// Shared by every admin-only API route (team invites, roster upload) —
// the client-side "you don't have access" pages are a UX nicety, this is
// the actual gate: an unauthenticated or non-admin caller never reaches
// the route's own logic.
export async function requireAdmin(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, status: 403, error: "Forbidden" };

  return { ok: true };
}
