"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { listTeamSubmissions, type NssSubmission } from "@/lib/nss/api";
import GlobalHeader from "@/components/GlobalHeader";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function ManagerDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<NssSubmission[]>([]);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const rows = await listTeamSubmissions(supabase, user.id);
      setSubmissions(rows);
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
        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">Manager Dashboard</h1>
        <p className="text-sm text-muted-foreground mb-8">Reports shared by your team, direct and indirect.</p>

        {loading ? (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">No reports from your team yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groups).map(([email, records]) => (
              <div key={email}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <span className="font-semibold text-foreground text-sm">{records[0].respondent_name}</span>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
