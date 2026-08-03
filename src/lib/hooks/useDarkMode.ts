"use client";

import { useEffect, useState } from "react";

function getInitialIsDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem("nss_theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function useDarkMode(): [boolean, (v: boolean) => void] {
  const [isDark, setIsDark] = useState(getInitialIsDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      localStorage.setItem("nss_theme", isDark ? "dark" : "light");
    } catch {
      // ignore
    }
  }, [isDark]);

  return [isDark, setIsDark];
}
