"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, Menu, X, Sun, Moon, LogOut, FileText, Users, Settings } from "lucide-react";
import BgbLogo from "./BgbLogo";
import BgbStar from "./BgbStar";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, isManager } from "@/lib/nss/userProfiles";
import { listSubmissionsForUser } from "@/lib/nss/api";

export default function GlobalHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useDarkMode();
  const [isAdmin, setIsAdmin] = useState(false);
  const [showManagerLink, setShowManagerLink] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const router = useRouter();

  const hasMenu = isAdmin || showManagerLink;
  const showHomeIcon = !hasMenu && hasCompleted;

  useEffect(() => {
    const check = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return;
      const [profile, managerCheck, submissions] = await Promise.all([
        getMyProfile(supabase, user.id),
        isManager(supabase, user.email),
        listSubmissionsForUser(supabase, user.id),
      ]);
      setIsAdmin(profile?.role === "admin");
      setShowManagerLink(managerCheck);
      setHasCompleted(submissions.length > 0);
    };
    check();
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
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
          {hasMenu ? (
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          ) : (
            showHomeIcon && (
              <Link
                href="/"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Home"
              >
                <Home className="w-5 h-5" />
              </Link>
            )
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

      {menuOpen && hasMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="fixed top-14 left-3 z-50 bg-card border border-border/50 rounded-xl shadow-lg py-1.5 w-52">
            <Link
              href="/"
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
            >
              <Home className="w-4 h-4 text-muted-foreground" />
              Home
            </Link>
            <Link
              href="/reports"
              onClick={() => setMenuOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
            >
              <FileText className="w-4 h-4 text-muted-foreground" />
              My Reports
            </Link>
            {showManagerLink && (
              <Link
                href="/manager"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                <Users className="w-4 h-4 text-muted-foreground" />
                Manager Dashboard
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/admin/users"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                <Settings className="w-4 h-4 text-muted-foreground" />
                Team Setup
              </Link>
            )}
          </div>
        </>
      )}

      <div className="h-14" />
    </>
  );
}
