"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { findInProgressSubmission, deleteSubmission, listSubmissionsForUser, type NssSubmission } from "@/lib/nss/api";
import GlobalHeader from "@/components/GlobalHeader";

export default function Welcome() {
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [nssEnabled, setNssEnabled] = useState(true);
  const [canResume, setCanResume] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [inProgressSubmission, setInProgressSubmission] = useState<NssSubmission | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const [{ data: profile }, inProgress, completedSubmissions] = await Promise.all([
          supabase.from("user_profiles").select("first_name, nss_enabled").eq("id", user.id).maybeSingle(),
          findInProgressSubmission(supabase, user.id),
          listSubmissionsForUser(supabase, user.id),
        ]);

        setFirstName(profile?.first_name ?? null);
        setNssEnabled(profile?.nss_enabled !== false);

        let hasLocalProgress = false;
        try {
          const raw = localStorage.getItem("nss_survey_state");
          if (raw) {
            const parsed = JSON.parse(raw);
            hasLocalProgress = (parsed.questionsAnswered || 0) > 0;
          }
        } catch {
          // ignore
        }

        const hasServerProgress = !!inProgress && (inProgress.questions_answered || 0) > 0;
        setInProgressSubmission(inProgress);
        setCanResume(hasLocalProgress || hasServerProgress);
        setHasCompleted(completedSubmissions.length > 0);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleStartOver = async () => {
    localStorage.removeItem("nss_survey_state");
    if (inProgressSubmission) {
      try {
        const supabase = createClient();
        await deleteSubmission(supabase, inProgressSubmission.id);
      } catch {
        // ignore — worst case the stale row lingers and can be cleared manually
      }
      setInProgressSubmission(null);
    }
    setCanResume(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />

      {loading ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-6 py-12 w-full">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-2">
              Welcome{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="text-muted-foreground text-lg mb-10">
              See the signals. Decode the system. Unlock what&apos;s possible.
            </p>

            {nssEnabled && (
              <div className="mb-6">
                {canResume ? (
                  <div className="flex flex-col gap-2">
                    {hasCompleted && (
                      <p className="text-sm text-muted-foreground mb-2">
                        Want to take a look at your reports? Head to{" "}
                        <Link
                          href="/reports"
                          className="underline underline-offset-2 hover:text-foreground transition-colors"
                        >
                          View My Reports
                        </Link>
                        .
                      </p>
                    )}
                    <Link href="/survey?resume=true">
                      <button className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-colors">
                        Resume the Needs Signal Survey
                      </button>
                    </Link>
                    <button
                      onClick={handleStartOver}
                      className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors text-left"
                    >
                      Or start from the beginning
                    </button>
                  </div>
                ) : hasCompleted ? (
                  <div className="flex flex-col gap-4">
                    <p className="text-foreground font-medium">You have a report ready to view!</p>
                    <Link href="/reports">
                      <button className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-colors">
                        View My Reports
                      </button>
                    </Link>
                    <p className="text-sm text-muted-foreground italic">
                      Want to take the Needs Signal Survey again? Click{" "}
                      <Link
                        href="/survey"
                        className="underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        here
                      </Link>
                      .
                    </p>
                  </div>
                ) : (
                  <Link href="/survey">
                    <button className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-colors">
                      Launch the Needs Signal Survey
                    </button>
                  </Link>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
