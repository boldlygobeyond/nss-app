"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, ShieldAlert, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, listAllProfiles, type UserProfile } from "@/lib/nss/userProfiles";
import { listAllSubmissions, type NssSubmission } from "@/lib/nss/api";
import { buildFullName } from "@/lib/nss/reportFilename";
import GlobalHeader from "@/components/GlobalHeader";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function AllUserReportsPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [submissions, setSubmissions] = useState<NssSubmission[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});

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
      const [rows, allProfiles] = await Promise.all([listAllSubmissions(supabase), listAllProfiles(supabase)]);
      setSubmissions(rows);
      setProfiles(Object.fromEntries(allProfiles.map((p) => [p.id, p])));
      setLoading(false);
    };
    load();
  }, []);

  const groups = submissions.reduce<Record<string, NssSubmission[]>>((acc, s) => {
    const key = s.user_email ?? s.respondent_name;
    (acc[key] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-2xl mx-auto px-6 py-12 w-full">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">All User Reports</h1>
        <p className="text-sm text-muted-foreground mb-8">Every generated report across the company.</p>

        {loading ? (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authorized ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">No reports have been generated yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groups).map(([email, records]) => {
              const profile = profiles[records[0].user_id];
              const fullName = buildFullName(profile?.first_name, profile?.last_name, records[0].respondent_name);
              return (
              <div key={email}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <span className="font-semibold text-foreground text-sm">{fullName}</span>
                  <span className="text-xs text-muted-foreground">{email}</span>
                </div>
                <div className="space-y-2 ml-9">
                  {records.map((s) => (
                    <div key={s.id} className="bg-card border border-border/50 rounded-xl p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Needs Signal Survey Report</p>
                          <p className="text-xs text-muted-foreground">{formatDate(s.updated_at)}</p>
                        </div>
                      </div>
                      <Link href={`/reports/${s.id}`}>
                        <button className="text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors">
                          View
                        </button>
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
