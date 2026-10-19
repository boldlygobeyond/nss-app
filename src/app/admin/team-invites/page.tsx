"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, Send, RotateCw, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, listAllProfiles, type UserProfile } from "@/lib/nss/userProfiles";
import GlobalHeader from "@/components/GlobalHeader";

type SendState = "idle" | "sending" | "sent" | "error";

function sortKey(p: UserProfile) {
  return `${p.team ?? ""}|${p.last_name ?? ""}|${p.first_name ?? ""}`;
}

export default function TeamInvitesPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [invited, setInvited] = useState<UserProfile[]>([]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [team, setTeam] = useState("");
  const [managerFirstName, setManagerFirstName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [formState, setFormState] = useState<SendState>("idle");
  const [formError, setFormError] = useState<string | null>(null);

  const [resendState, setResendState] = useState<Record<string, SendState>>({});

  const loadInvited = async () => {
    const supabase = createClient();
    const rows = await listAllProfiles(supabase);
    setInvited(rows.filter((p) => p.team).sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
  };

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const myProfile = await getMyProfile(supabase, user.id);
      if (myProfile?.role !== "admin") {
        setLoading(false);
        return;
      }
      setAuthorized(true);
      await loadInvited();
      setLoading(false);
    };
    load();
  }, []);

  const sendInvite = async (payload: {
    firstName: string;
    lastName: string;
    email: string;
    team: string;
    managerEmail: string;
    managerFirstName?: string;
  }): Promise<boolean> => {
    const res = await fetch("/api/nss/team-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !team.trim() || !managerEmail.trim()) return;
    setFormState("sending");
    setFormError(null);
    const ok = await sendInvite({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      team: team.trim(),
      managerEmail: managerEmail.trim(),
      managerFirstName: managerFirstName.trim() || undefined,
    });
    if (!ok) {
      setFormState("error");
      setFormError("Could not send invite. Please try again.");
      return;
    }
    setFormState("sent");
    setFirstName("");
    setLastName("");
    setEmail("");
    // Team and manager fields stay filled — inviting a whole roster means
    // entering the same team/manager repeatedly, just a different person.
    await loadInvited();
    setTimeout(() => setFormState("idle"), 2000);
  };

  const handleResend = async (profile: UserProfile) => {
    if (!profile.team || !profile.manager_email) return;
    setResendState((s) => ({ ...s, [profile.id]: "sending" }));
    const ok = await sendInvite({
      firstName: profile.first_name ?? "there",
      lastName: profile.last_name ?? "",
      email: profile.email,
      team: profile.team,
      managerEmail: profile.manager_email,
    });
    setResendState((s) => ({ ...s, [profile.id]: ok ? "sent" : "error" }));
    if (ok) setTimeout(() => setResendState((s) => ({ ...s, [profile.id]: "idle" })), 2000);
  };

  const inputClass =
    "h-10 rounded-lg bg-background border border-border/50 focus:border-primary focus:outline-none px-3 text-sm w-full";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-3xl mx-auto px-6 py-12 w-full">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">Team Invites</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Invite pilot/team members directly — separate from the public lead-capture funnel. They won&apos;t
          generate a CRM entry, and their manager will see their report once it&apos;s done.
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
          <>
            <form onSubmit={handleSubmit} className="bg-card border border-border/50 rounded-2xl p-6 mb-10">
              <h2 className="font-heading text-sm font-semibold text-foreground mb-4">Invite someone new</h2>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <input
                  className={inputClass}
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
                <input
                  className={inputClass}
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
              <input
                className={`${inputClass} mb-3`}
                type="email"
                placeholder="Their email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <input
                  className={inputClass}
                  placeholder="Team (e.g. wi-lgbt-chamber-2026)"
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  required
                />
                <input
                  className={inputClass}
                  placeholder="Manager's first name"
                  value={managerFirstName}
                  onChange={(e) => setManagerFirstName(e.target.value)}
                />
              </div>
              <input
                className={`${inputClass} mb-4`}
                type="email"
                placeholder="Manager's email"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                required
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={formState === "sending"}
                  className="flex items-center gap-2 h-10 px-4 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {formState === "sending" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : formState === "sent" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {formState === "sent" ? "Invite sent" : "Send invite"}
                </button>
                {formError && <span className="text-xs text-destructive">{formError}</span>}
              </div>
            </form>

            <h2 className="font-heading text-sm font-semibold text-foreground mb-3">Invited so far</h2>
            {invited.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one invited yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border/50">
                <table className="w-full border-collapse">
                  <thead className="bg-secondary">
                    <tr>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Manager</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody className="bg-card">
                    {invited.map((p) => {
                      const state = resendState[p.id] ?? "idle";
                      return (
                        <tr key={p.id} className="border-b border-border/30 last:border-0">
                          <td className="p-3 text-sm text-muted-foreground">{p.team}</td>
                          <td className="p-3 text-sm text-foreground">
                            {[p.first_name, p.last_name].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="p-3 text-sm text-muted-foreground">{p.email}</td>
                          <td className="p-3 text-sm text-muted-foreground">{p.manager_email ?? "—"}</td>
                          <td className="p-3">
                            <button
                              onClick={() => handleResend(p)}
                              disabled={state === "sending"}
                              className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-border/50 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                            >
                              {state === "sending" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : state === "sent" ? (
                                <Check className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <RotateCw className="w-3.5 h-3.5" />
                              )}
                              {state === "sent" ? "Sent" : "Resend"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
