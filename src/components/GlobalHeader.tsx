"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, Sun, Moon, LogOut } from "lucide-react";
import { sendGAEvent } from "@next/third-parties/google";
import BgbLogo from "./BgbLogo";
import BgbStar from "./BgbStar";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, isManager } from "@/lib/nss/userProfiles";

export default function GlobalHeader() {
  const [isDark, setIsDark] = useDarkMode();
  // Regular end users are one-and-done — once they've taken the NSS
  // they're just here for their results, so there's no "home" for them to
  // navigate back to. Only admins/managers, who have other destinations
  // (their team's reports, Team Setup), get a home link.
  const [isElevated, setIsElevated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return;
      const [profile, managerCheck] = await Promise.all([
        getMyProfile(supabase, user.id),
        isManager(supabase, user.email).catch(() => false),
      ]);
      setIsElevated(profile?.role === "admin" || managerCheck);
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
          {isElevated && (
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
          {isElevated ? (
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
            onClick={() => sendGAEvent("event", "outbound_click", { link_location: "header" })}
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
