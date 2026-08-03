"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, X, Sun, Moon, LogOut, Home, FileText, Users, Settings } from "lucide-react";
import BgbLogo from "./BgbLogo";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, isManager } from "@/lib/nss/userProfiles";

export default function GlobalHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useDarkMode();
  const [showManagerLink, setShowManagerLink] = useState(false);
  const [showAdminLink, setShowAdminLink] = useState(false);
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
        isManager(supabase, user.email),
      ]);
      setShowAdminLink(profile?.role === "admin");
      setShowManagerLink(managerCheck);
    };
    check();
  }, []);

  const handleLogout = async () => {
    setMenuOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card/95 backdrop-blur-sm flex items-center px-4 border-b border-border/50">
        <div className="w-10 flex items-center">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <Link href="/">
            <BgbLogo height={24} />
          </Link>
        </div>

        <div className="w-10" />
      </header>

      {menuOpen && (
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
            {showAdminLink && (
              <Link
                href="/admin/users"
                onClick={() => setMenuOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
              >
                <Settings className="w-4 h-4 text-muted-foreground" />
                Team Setup
              </Link>
            )}
            <button
              onClick={() => {
                setIsDark(!isDark);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
              {isDark ? "Light Mode" : "Dark Mode"}
            </button>
            <div className="my-1 border-t border-border/50" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </>
      )}

      <div className="h-14" />
    </>
  );
}
