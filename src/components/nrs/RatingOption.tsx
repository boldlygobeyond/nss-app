"use client";

import { useEffect, useRef, useState } from "react";

// No tooltip/popover library exists in this codebase — this is a small,
// self-contained accessible equivalent. Reveal triggers: hover (mouse),
// focus-visible (keyboard only — CSS :focus-visible, not plain :focus, so
// clicking the button doesn't leave the tooltip "stuck" open the way a
// JS onFocus/onBlur pair would, since a mouse click does focus the button
// but browsers don't count that as focus-visible), and a pinned
// tap-to-reveal for touch, dismissed by tapping anywhere outside the
// option.
export default function RatingOption({
  idPrefix,
  value,
  label,
  description,
  selected,
  onSelect,
}: {
  // Scopes the description's id to the question it belongs to — needed
  // once multiple questions' rating rows are on the page at once (the
  // single-page assessment layout), since `value` alone (1-5) repeats
  // across every question.
  idPrefix: number | string;
  value: number;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const descId = `nrs-rating-desc-${idPrefix}-${value}`;
  const revealed = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    const dismiss = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pinned]);

  const handleTouchStart = (e: React.TouchEvent) => {
    // First tap on a touch device reveals the description instead of
    // immediately selecting, matching "hover over a rating to learn
    // more" having a real touch equivalent. A second tap (now pinned)
    // falls through to the button's own onClick and selects.
    if (!pinned) {
      e.preventDefault();
      setPinned(true);
    }
  };

  return (
    <div ref={containerRef} className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onTouchStart={handleTouchStart}
        aria-describedby={descId}
        aria-pressed={selected}
        className={`peer w-full flex flex-col items-center gap-1 sm:gap-1.5 py-3 sm:py-4 px-1 sm:px-2 rounded-xl border transition-all ${
          selected
            ? "bg-primary/10 border-primary/50"
            : "bg-transparent border-border/50 hover:bg-secondary/60 hover:border-border"
        }`}
      >
        <span className={`text-base sm:text-lg font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
          {value}
        </span>
        <span className="text-[10px] sm:text-xs font-medium text-foreground text-center leading-tight">
          {label}
        </span>
      </button>
      <span
        id={descId}
        role="tooltip"
        className={`absolute top-full mt-2 w-40 sm:w-48 text-center text-xs text-muted-foreground bg-card border border-border/50 rounded-lg px-3 py-2 shadow-md z-10 transition-opacity pointer-events-none ${
          revealed ? "opacity-100" : "opacity-0 peer-focus-visible:opacity-100"
        }`}
      >
        {description}
      </span>
    </div>
  );
}
