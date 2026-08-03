"use client";

import { useDarkMode } from "@/lib/hooks/useDarkMode";

// Mounted once at the root layout so the .dark class is applied consistently
// on every page, not only ones that happen to render a component that calls
// useDarkMode() for its own purposes (e.g. GlobalHeader's toggle button).
export default function ThemeInit() {
  useDarkMode();
  return null;
}
