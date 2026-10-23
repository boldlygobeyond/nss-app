"use client";

import { useEffect, type RefObject } from "react";

// Shared by the Team Needs Landscape and Needs Spectrum detail panels —
// dismisses the current selection on an outside click/tap or on Escape.
// Only attaches listeners while something is actually selected.
export function useDismissOnOutsideOrEscape(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!active) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, containerRef, onDismiss]);
}
