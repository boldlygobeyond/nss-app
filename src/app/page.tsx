"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, FileText, Users, Files, Settings, RefreshCw, type LucideIcon } from "lucide-react";
import { sendGAEvent } from "@next/third-parties/google";
import { createClient } from "@/lib/supabase/client";
import { listSubmissionsForUser } from "@/lib/nss/api";
import { isManager } from "@/lib/nss/userProfiles";
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
        <a
          href="https://boldlygobeyond.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sendGAEvent("event", "outbound_click", { link_location: "NSS_landing_logo" })}
        >
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

function AdminHomescreen({
  isAdmin,
  isManagerRole,
  myReportId,
}: {
  isAdmin: boolean;
  isManagerRole: boolean;
  myReportId: string | null;
}) {
  const cards: { href: string; label: string; description: string; icon: LucideIcon }[] = [
    {
      href: myReportId ? `/reports/${myReportId}` : "/reports",
      label: "My Report",
      description: "View your Needs Signal Report.",
      icon: FileText,
    },
    isManagerRole && {
      href: "/manager",
      label: "Manager Dashboard",
      description: "Reports from your direct and indirect team.",
      icon: Users,
    },
    isAdmin && {
      href: "/admin/reports",
      label: "All User Reports",
      description: "Every generated report across the company.",
      icon: Files,
    },
    isAdmin && {
      href: "/admin/users",
      label: "Team Setup",
      description: "Manage roles and the reporting hierarchy.",
      icon: Settings,
    },
    isAdmin && {
      href: "/survey",
      label: "Retake the Survey",
      description: "Start a new attempt, useful for testing changes.",
      icon: RefreshCw,
    },
  ].filter((c): c is { href: string; label: string; description: string; icon: LucideIcon } => !!c);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 w-full">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        {isManagerRole && (
          <h1 className="font-heading text-2xl font-bold text-foreground mb-6">Needs Signal Survey</h1>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="bg-card border border-border/50 rounded-2xl p-6 flex flex-col gap-3 hover:border-primary/40 hover:shadow-md transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <card.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-heading font-semibold text-foreground">{card.label}</p>
                <p className="text-sm text-muted-foreground mt-1">{card.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function AuthenticatedHome() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isManagerRole, setIsManagerRole] = useState(false);
  const [myReportId, setMyReportId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      let redirected = false;
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.email) return;

        const [{ data: profile }, completedSubmissions, managerCheck] = await Promise.all([
          supabase.from("user_profiles").select("first_name, nss_enabled, role").eq("id", user.id).maybeSingle(),
          listSubmissionsForUser(supabase, user.id),
          // Best-effort — a hiccup here (e.g. the is_manager RPC briefly
          // unavailable) shouldn't take down the whole homepage load, just
          // fall back to "not a manager" for this visit.
          isManager(supabase, user.email).catch(() => false),
        ]);

        const enabled = profile?.nss_enabled !== false;
        const completed = completedSubmissions.length > 0;
        const admin = profile?.role === "admin";
        const elevated = admin || managerCheck;

        // Anyone who hasn't finished (started or not) goes straight into the
        // survey instead of landing on a homepage first — admins included,
        // so they can test the flow themselves.
        if (enabled && !completed) {
          redirected = true;
          router.replace("/survey");
          return;
        }

        // Regular end users are one-and-done — once completed there is
        // nothing else for them to do here, so skip this page entirely and
        // go straight into their report. Admins/managers still land here
        // since they have other destinations (their team's reports, Team
        // Setup, retaking the survey to test changes).
        if (completed && !elevated) {
          redirected = true;
          router.replace(`/reports/${completedSubmissions[0].id}`);
          return;
        }

        setFirstName(profile?.first_name ?? null);
        setHasCompleted(completed);
        setIsAdmin(admin);
        setIsManagerRole(managerCheck);
        setMyReportId(completedSubmissions[0]?.id ?? null);
      } finally {
        if (!redirected) setLoading(false);
      }
    };
    loadData();
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />

      {loading ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : hasCompleted ? (
        <AdminHomescreen isAdmin={isAdmin} isManagerRole={isManagerRole} myReportId={myReportId} />
      ) : (
        <div className="max-w-2xl mx-auto px-6 py-12 w-full">
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-2">
            Welcome{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-muted-foreground text-lg">
            The Needs Signal Survey isn&apos;t currently available for your account.
          </p>
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
