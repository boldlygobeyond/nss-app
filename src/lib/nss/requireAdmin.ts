import { createClient } from "@/lib/supabase/server";

// Shared by every admin-only API route (team invites, roster upload) —
// the client-side "you don't have access" pages are a UX nicety, this is
// the actual gate: an unauthenticated or non-admin caller never reaches
// the route's own logic. Returns the admin's own user id on success so a
// route can attribute an action to who actually took it (e.g.
// nrs_send_log.sent_by) without a second auth.getUser() call — purely
// additive, every existing caller only ever checked `.ok`.
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; status: number; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return { ok: false, status: 403, error: "Forbidden" };

  return { ok: true, userId: user.id };
}
