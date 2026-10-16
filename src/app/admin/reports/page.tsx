"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, FileText, Loader2, Search, ShieldAlert, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, listAllProfiles, type UserProfile } from "@/lib/nss/userProfiles";
import { listAllSubmissions, type NssSubmission } from "@/lib/nss/api";
import { buildFullName } from "@/lib/nss/reportFilename";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import GlobalHeader from "@/components/GlobalHeader";

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// v2 = the current 86-question Bradley-Terry bank (ids 51+); v1 = the
// original 50-question win-rate bank. question_sequence only ever contains
// ids from whichever bank was actually shown, so any id >= 51 is
// conclusive — no other signal needed.
function bankVersion(s: NssSubmission): "v1" | "v2" {
  return s.question_sequence?.some((id) => id >= 51) ? "v2" : "v1";
}

export default function AllUserReportsPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [submissions, setSubmissions] = useState<NssSubmission[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [completedAt, setCompletedAt] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [versionFilter, setVersionFilter] = useState<"all" | "v1" | "v2">("all");

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

      // updated_at isn't trustworthy as "when they finished" — a DB
      // trigger bumps it on every write to the row, including PDF
      // caching, Drive archival, and download-link clicks that can
      // happen days or weeks later. The timestamp of their last actual
      // answer is the real completion moment and nothing touches it
      // after the fact.
      // .order("id") keeps .range() paging stable — without it, a
      // concurrent write (e.g. someone mid-survey) can shift row order
      // between page requests and cause a row to be double-fetched or
      // dropped.
      const allResponses = await fetchAllRows<{ submission_id: string; answered_at: string }>((from, to) =>
        supabase.from("nss_responses").select("submission_id, answered_at").order("id").range(from, to),
      );
      const lastAnswered: Record<string, string> = {};
      allResponses.forEach((r) => {
        if (!lastAnswered[r.submission_id] || r.answered_at > lastAnswered[r.submission_id]) {
          lastAnswered[r.submission_id] = r.answered_at;
        }
      });
      setCompletedAt(lastAnswered);

      setLoading(false);
    };
    load();
  }, []);

  // Array, not an object — needs an explicit sort order (newest completion
  // first), both for which person's group leads and for that person's own
  // reports within it, rather than relying on insertion/key order.
  const groupList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bySubmission = submissions.filter((s) => {
      if (versionFilter !== "all" && bankVersion(s) !== versionFilter) return false;
      if (!q) return true;
      const profile = profiles[s.user_id];
      const fullName = buildFullName(profile?.first_name, profile?.last_name, s.respondent_name);
      const haystack = `${fullName} ${s.user_email ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
    const byKey = bySubmission.reduce<Record<string, NssSubmission[]>>((acc, s) => {
      const key = s.user_email ?? s.respondent_name;
      (acc[key] ??= []).push(s);
      return acc;
    }, {});
    const completedOf = (s: NssSubmission) => completedAt[s.id] ?? s.updated_at;
    return Object.entries(byKey)
      .map(([key, records]) => [key, [...records].sort((a, b) => (completedOf(b) > completedOf(a) ? 1 : -1))] as const)
      .sort(([, a], [, b]) => (completedOf(b[0]) > completedOf(a[0]) ? 1 : -1));
  }, [submissions, profiles, search, versionFilter, completedAt]);

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
          <>
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full bg-card border border-border/50 rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div className="flex items-center gap-1 bg-card border border-border/50 rounded-lg p-1">
                {(["all", "v1", "v2"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVersionFilter(v)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                      versionFilter === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {v === "all" ? "All versions" : v}
                  </button>
                ))}
              </div>
            </div>

            {groupList.length === 0 ? (
              <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
                <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-muted-foreground text-sm">No reports match your search or filter.</p>
              </div>
            ) : (
          <div className="space-y-8">
            {groupList.map(([email, records]) => {
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
                          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                            Needs Signal Survey Report
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                bankVersion(s) === "v2"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {bankVersion(s)}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDate(completedAt[s.id] ?? s.updated_at)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link href={`/admin/reports/${s.id}/insights`}>
                          <button className="text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors inline-flex items-center gap-1.5">
                            <BarChart3 className="w-3 h-3" /> Insights
                          </button>
                        </Link>
                        <Link href={`/reports/${s.id}`}>
                          <button className="text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors">
                            View
                          </button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
