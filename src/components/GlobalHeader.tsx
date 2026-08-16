"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, Sun, Moon, LogOut } from "lucide-react";
import BgbLogo from "./BgbLogo";
import BgbStar from "./BgbStar";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import { createClient } from "@/lib/supabase/client";
import { listSubmissionsForUser } from "@/lib/nss/api";

export default function GlobalHeader() {
  const [isDark, setIsDark] = useDarkMode();
  const [hasCompleted, setHasCompleted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const submissions = await listSubmissionsForUser(supabase, user.id);
      setHasCompleted(submissions.length > 0);
    };
    check();
  }, []);

  const handleLogout = async () => {
    localStorage.removeItem("nss_survey_state");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card/95 backdrop-blur-sm flex items-center px-4 border-b border-border/50">
        <div className="w-28 flex items-center">
          {hasCompleted && (
            <Link
              href="/"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Home"
            >
              <Home className="w-5 h-5" />
            </Link>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center">
          {hasCompleted ? (
            <Link href="/">
              <BgbLogo height={24} />
            </Link>
          ) : (
            <BgbLogo height={24} />
          )}
        </div>

        <div className="w-28 flex items-center justify-end gap-1">
          <a
            href="https://boldlygobeyond.com"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Boldly Go Beyond website"
          >
            <BgbStar size={20} />
          </a>
          <button
            onClick={() => setIsDark(!isDark)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
            aria-label="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="h-14" />
    </>
  );
}
