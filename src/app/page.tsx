"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { findInProgressSubmission, deleteSubmission, listSubmissionsForUser, type NssSubmission } from "@/lib/nss/api";
import GlobalHeader from "@/components/GlobalHeader";
import BgbLogo from "@/components/BgbLogo";
import LeadCaptureModal from "@/components/LeadCaptureModal";
import LoginModal from "@/components/LoginModal";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

function buildLeadSource(searchParams: URLSearchParams): string | null {
  const source = searchParams.get("source");
  if (source) return source;

  const utmPairs = UTM_KEYS.map((key) => {
    const value = searchParams.get(key);
    return value ? `${key}=${value}` : null;
  }).filter(Boolean);

  return utmPairs.length > 0 ? utmPairs.join("&") : null;
}

function LandingPage() {
  const searchParams = useSearchParams();
  const leadSource = buildLeadSource(searchParams);
  const authError = searchParams.get("authError");
  const [showLeadCapture, setShowLeadCapture] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {authError && (
        <div className="bg-destructive/10 text-destructive text-sm text-center py-2 px-4">
          Sign-in failed: {authError}. Please request a new link.
        </div>
      )}
      <div className="h-20 flex items-center justify-center">
        <a href="https://boldlygobeyond.com" target="_blank" rel="noopener noreferrer">
          <BgbLogo height={26} />
        </a>
      </div>

      <div className="flex-1 max-w-2xl mx-auto px-6 pb-16 w-full flex flex-col justify-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="font-heading text-3xl md:text-5xl font-bold text-foreground mb-6 text-center leading-tight">
            You aren&apos;t static. Neither are your workplace needs.
          </h1>
          <p className="text-muted-foreground text-lg mb-10 text-center leading-relaxed">
            Traditional personality tests treat you as fixed and unchanging. But what you need to thrive evolves
            over time and shifts across different environments. Our Needs Signal Survey gives you a real-time
            snapshot of what&apos;s important to you right now and provides concrete signals to let you know when
            your needs are met or unmet.
          </p>

          <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8 text-center shadow-sm mb-8">
            <p className="text-foreground text-base md:text-lg leading-relaxed mb-6">
              Take this free 50-question &quot;would you rather&quot; style quiz today and get instant insights
              that you can use to advocate for what you need to show up as your best.
            </p>
            <button
              onClick={() => setShowLeadCapture(true)}
              className="h-12 px-10 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-colors"
            >
              See Your Signals
            </button>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Already taken the survey and want to view your results? Click{" "}
            <button
              onClick={() => setShowLogin(true)}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              here
            </button>{" "}
            to log in.
          </p>
        </motion.div>
      </div>

      {showLeadCapture && (
        <LeadCaptureModal leadSource={leadSource} onClose={() => setShowLeadCapture(false)} />
      )}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}

function AuthenticatedHome() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [nssEnabled, setNssEnabled] = useState(true);
  const [canResume, setCanResume] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [inProgressSubmission, setInProgressSubmission] = useState<NssSubmission | null>(null);

  useEffect(() => {
    const loadData = async () => {
      let redirected = false;
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

        const enabled = profile?.nss_enabled !== false;
        const hasCompleted = completedSubmissions.length > 0;

        // The homepage is only for people who already have a result to look
        // at — anyone who hasn't finished (started or not, admins included
        // so they can test the flow themselves) goes straight into the
        // survey instead of landing on a "Launch" button first.
        if (enabled && !hasCompleted) {
          redirected = true;
          router.replace("/survey");
          return;
        }

        setFirstName(profile?.first_name ?? null);
        setNssEnabled(enabled);
        setHasCompleted(hasCompleted);

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
      } finally {
        if (!redirected) setLoading(false);
      }
    };
    loadData();
  }, [router]);

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
                    <Link href="/survey">
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

function WelcomeGate() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const check = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setAuthenticated(!!user);
      setChecking(false);
    };
    check();
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return authenticated ? <AuthenticatedHome /> : <LandingPage />;
}

export default function Welcome() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <WelcomeGate />
    </Suspense>
  );
}
