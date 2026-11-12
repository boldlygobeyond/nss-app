"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

// A trigger button (the existing per-row/bulk send icon) that opens a
// small dropdown offering "send test to me" alongside the real send
// action — used by both the NSS Invites tab and the NRS tab so the two
// don't duplicate click-outside/escape-to-close logic. Deliberately
// click-to-open rather than hover, matching every other control in these
// tables.
//
// The menu is portaled to document.body and positioned with `fixed`
// coordinates computed from the trigger's own rect, rather than living
// inside a normal `absolute` wrapper next to the button. Every caller
// renders this inside a table wrapped in `overflow-x-auto` for the
// horizontal-scroll affordance on small screens — and per the CSS spec,
// setting overflow-x to anything but `visible` silently makes the
// computed overflow-y `auto` too, which clips an `absolute`-positioned
// dropdown right along with real scroll overflow. `fixed` positioning
// escapes that clipping entirely since it's relative to the viewport,
// not any scrolling ancestor.
export default function SendActionMenu({
  icon,
  title,
  disabled,
  className,
  testLabel,
  liveLabel,
  liveDisabled,
  liveDisabledTitle,
  onSendTest,
  onSendLive,
}: {
  icon: ReactNode;
  title?: string;
  disabled?: boolean;
  className: string;
  testLabel: string;
  liveLabel: string;
  // Disables only the "send to participant" option, independent of the
  // trigger/test option — a test send never reaches the real participant,
  // so it stays available even when the live send is blocked (e.g. the
  // "attended See the Signals" prerequisite not yet met).
  liveDisabled?: boolean;
  liveDisabledTitle?: string;
  onSendTest: () => void;
  onSendLive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Scrolling or resizing invalidates the coordinates we computed at
    // open time — closing is simpler and safer than re-measuring on
    // every scroll tick for what's a quick, transient menu anyway.
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button ref={buttonRef} onClick={toggle} disabled={disabled} title={title} className={className}>
        {icon}
        {/* Small, always-present affordance that this is a menu, not an
            immediate send — without it the icon alone reads as "click to
            send right now." */}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="w-52 rounded-lg border border-border bg-card shadow-lg z-50 py-1 text-left"
          >
            <button
              onClick={() => {
                setOpen(false);
                onSendTest();
              }}
              className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors"
            >
              {testLabel}
            </button>
            <button
              onClick={() => {
                if (liveDisabled) return;
                setOpen(false);
                onSendLive();
              }}
              disabled={liveDisabled}
              title={liveDisabled ? liveDisabledTitle : undefined}
              className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              {liveLabel}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
