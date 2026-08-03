"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, listAllProfiles, updateProfile, type UserProfile } from "@/lib/nss/userProfiles";
import GlobalHeader from "@/components/GlobalHeader";

function UserRow({ profile }: { profile: UserProfile }) {
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [managerEmail, setManagerEmail] = useState(profile.manager_email ?? "");
  const [role, setRole] = useState(profile.role);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const supabase = createClient();
    await updateProfile(supabase, profile.id, {
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      manager_email: managerEmail.trim() || null,
      role,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const inputClass =
    "h-9 rounded-md bg-background border border-border/50 focus:border-primary focus:outline-none px-2 text-sm w-full";

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="p-3 text-sm text-foreground align-top">{profile.email}</td>
      <td className="p-3 align-top">
        <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
      </td>
      <td className="p-3 align-top">
        <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
      </td>
      <td className="p-3 align-top">
        <input
          className={inputClass}
          value={managerEmail}
          onChange={(e) => setManagerEmail(e.target.value)}
          placeholder="manager@company.com"
        />
      </td>
      <td className="p-3 align-top">
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as "user" | "admin")}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </td>
      <td className="p-3 align-top text-sm text-muted-foreground">{profile.lead_source ?? "—"}</td>
      <td className="p-3 align-top">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5 text-primary" /> : null}
          {saved ? "Saved" : "Save"}
        </button>
      </td>
    </tr>
  );
}

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const myProfile = await getMyProfile(supabase, user.id);
      if (myProfile?.role !== "admin") {
        setLoading(false);
        return;
      }

      setAuthorized(true);
      const rows = await listAllProfiles(supabase);
      setProfiles(rows);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-4xl mx-auto px-6 py-12 w-full">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Team Setup</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Set each person&apos;s name and manager&apos;s email to build the reporting hierarchy the Manager
          Dashboard uses. A person must have signed in at least once before they appear here.
        </p>

        {loading ? (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authorized ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full border-collapse">
              <thead className="bg-secondary">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">First name</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last name</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manager&apos;s email</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lead source</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="bg-card">
                {profiles.map((p) => (
                  <UserRow key={p.id} profile={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
