"use client";

import { useEffect, useRef } from "react";

// A small dot-matrix figure that cycles disco -> YMCA -> moonwalk on a
// canvas, built from pose parameters (not a sprite sheet) — the exact
// routine validated as a standalone preview before being wired in here.
// Only lit dots are ever drawn; there's no background grid, so this sits
// transparently over whatever's behind it in either theme. Dot color
// comes from the app's own --primary token, re-read on every frame
// (every ~280ms) rather than once on mount, so a theme change while this
// is on screen is picked up automatically without any extra wiring.
const COLS = 34;
const ROWS = 28;
const FRAME_MS = 280;

type DotSet = Set<string>;

function addRect(set: DotSet, r0: number, r1: number, c0: number, c1: number) {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set.add(`${r},${c}`);
}
function addCircle(set: DotSet, cr: number, cc: number, radius: number) {
  const r0 = Math.floor(cr - radius);
  const r1 = Math.ceil(cr + radius);
  const c0 = Math.floor(cc - radius);
  const c1 = Math.ceil(cc + radius);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const dr = r - cr;
      const dc = c - cc;
      if (dr * dr + dc * dc <= radius * radius + 0.25) set.add(`${r},${c}`);
    }
  }
}
function addLine(set: DotSet, r0: number, c0: number, r1: number, c1: number) {
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    set.add(`${Math.round(r0 + (r1 - r0) * t)},${Math.round(c0 + (c1 - c0) * t)}`);
  }
}

function addHelmetAndTorso(on: DotSet, bob: number, cx: number): number {
  addCircle(on, 6 + bob, cx, 3.3);
  addRect(on, 9 + bob, 9 + bob, cx - 1, cx);
  const shoulderRow = 10 + bob;
  addRect(on, shoulderRow, shoulderRow, cx - 4, cx + 4);
  addRect(on, shoulderRow + 1, shoulderRow + 3, cx - 3, cx + 3);
  addRect(on, shoulderRow + 4, shoulderRow + 5, cx - 3, cx + 3);
  return shoulderRow;
}
function legSlots(cx: number): { L: [number, number]; R: [number, number] } {
  return { L: [cx - 4, cx - 3], R: [cx + 3, cx + 4] };
}
function addLeg(on: DotSet, hipRow: number, slot: [number, number], rowsDown: number, flatFoot: boolean) {
  const [c0, c1] = slot;
  addRect(on, hipRow, hipRow + rowsDown - 1, c0, c1);
  if (flatFoot) addRect(on, hipRow + rowsDown, hipRow + rowsDown, c0 - 1, c1 + 1);
}

const CX_STATIC = 17;

function discoFrame(pointRight: boolean, hipShift: number, bob: number): DotSet {
  const on: DotSet = new Set();
  const cx = CX_STATIC;
  const shoulderRow = addHelmetAndTorso(on, bob, cx);
  const hipRow = shoulderRow + 6;
  const slots = legSlots(cx);
  if (pointRight) {
    addLine(on, shoulderRow, cx + 4, shoulderRow - 4, cx + 7);
    addRect(on, shoulderRow + 1, shoulderRow + 2, cx - 6, cx - 5);
  } else {
    addLine(on, shoulderRow, cx - 4, shoulderRow - 4, cx - 7);
    addRect(on, shoulderRow + 1, shoulderRow + 2, cx + 5, cx + 6);
  }
  addLeg(on, hipRow, [slots.L[0] + hipShift, slots.L[1] + hipShift], 6, true);
  addLeg(on, hipRow, [slots.R[0] + hipShift, slots.R[1] + hipShift], 6, true);
  return on;
}
const discoFrames = [discoFrame(true, -1, 0), discoFrame(true, 0, 1), discoFrame(false, 1, 0), discoFrame(false, 0, 1)];

function ymcaFrame(letter: "Y" | "M" | "C" | "A", sway: number, bob: number): DotSet {
  const on: DotSet = new Set();
  const cx = CX_STATIC;
  const shoulderRow = addHelmetAndTorso(on, bob, cx);
  const hipRow = shoulderRow + 6;
  const slots = legSlots(cx);
  if (letter === "Y") {
    addLine(on, shoulderRow, cx - 4, shoulderRow - 6, cx - 8);
    addLine(on, shoulderRow, cx + 4, shoulderRow - 6, cx + 8);
  } else if (letter === "M") {
    addLine(on, shoulderRow, cx - 4, shoulderRow - 2, cx - 7);
    addLine(on, shoulderRow - 2, cx - 7, shoulderRow - 7, cx - 2);
    addLine(on, shoulderRow, cx + 4, shoulderRow - 2, cx + 7);
    addLine(on, shoulderRow - 2, cx + 7, shoulderRow - 7, cx + 2);
  } else if (letter === "C") {
    // Top bar (right arm, straight out) and bottom bar (left arm,
    // crossing the body down to the same right-side reach) — the torso's
    // own left edge is the C's vertical spine, nothing extra drawn there.
    addLine(on, shoulderRow - 1, cx + 4, shoulderRow - 1, cx + 9);
    addLine(on, shoulderRow, cx - 4, shoulderRow + 6, cx + 9);
  } else {
    addLine(on, shoulderRow, cx - 4, shoulderRow - 10, cx);
    addLine(on, shoulderRow, cx + 4, shoulderRow - 10, cx);
  }
  addLeg(on, hipRow, [slots.L[0] + sway, slots.L[1] + sway], 6, true);
  addLeg(on, hipRow, [slots.R[0] + sway, slots.R[1] + sway], 6, true);
  return on;
}
const ymcaFrames: DotSet[] = [];
(["Y", "M", "C", "A"] as const).forEach((letter) => {
  ymcaFrames.push(ymcaFrame(letter, -1, 0));
  ymcaFrames.push(ymcaFrame(letter, 1, 1));
});

function moonwalkFrame(cx: number, bob: number, armsOut: boolean): DotSet {
  const on: DotSet = new Set();
  const shoulderRow = addHelmetAndTorso(on, bob, cx);
  const hipRow = shoulderRow + 6;
  if (armsOut) {
    addRect(on, shoulderRow, shoulderRow + 1, cx - 7, cx - 5);
    addRect(on, shoulderRow, shoulderRow + 1, cx + 5, cx + 7);
  } else {
    addRect(on, shoulderRow + 1, shoulderRow + 3, cx - 4, cx - 3);
    addRect(on, shoulderRow + 1, shoulderRow + 3, cx + 3, cx + 4);
  }
  // Feet together, one shared flare — a gliding stance, not a stride.
  addRect(on, hipRow, hipRow + 6, cx - 2, cx - 1);
  addRect(on, hipRow, hipRow + 6, cx + 1, cx + 2);
  addRect(on, hipRow + 7, hipRow + 7, cx - 3, cx + 3);
  return on;
}
const moonwalkFrames = [
  moonwalkFrame(26, 0, true),
  moonwalkFrame(22, 1, false),
  moonwalkFrame(18, 0, true),
  moonwalkFrame(14, 1, false),
  moonwalkFrame(10, 0, true),
  moonwalkFrame(8, 1, false),
];

const routine: { frames: DotSet[]; loopMs: number }[] = [
  { frames: discoFrames, loopMs: 3200 },
  { frames: ymcaFrames, loopMs: 4200 },
  { frames: moonwalkFrames, loopMs: 4200 },
];

// The finish pose — arms thrown up and wide (a bigger, more triumphant
// spread than YMCA's Y), landed in a stable flat-footed stance rather
// than mid-step. Shown once, held, when the caller sets `done`.
function tadaFrame(): DotSet {
  const on: DotSet = new Set();
  const cx = CX_STATIC;
  const shoulderRow = addHelmetAndTorso(on, 0, cx);
  const hipRow = shoulderRow + 6;
  addLine(on, shoulderRow, cx - 4, shoulderRow - 7, cx - 10);
  addLine(on, shoulderRow, cx + 4, shoulderRow - 7, cx + 10);
  addLeg(on, hipRow, [cx - 5, cx - 4], 6, true);
  addLeg(on, hipRow, [cx + 4, cx + 5], 6, true);
  return on;
}
const tadaPose = tadaFrame();

export default function DotMatrixDancer({ cellSize = 4, done = false }: { cellSize?: number; done?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = COLS * cellSize * dpr;
    canvas.height = ROWS * cellSize * dpr;
    canvas.style.width = `${COLS * cellSize}px`;
    canvas.style.height = `${ROWS * cellSize}px`;
    ctx.scale(dpr, dpr);

    const drawFrame = (on: DotSet) => {
      const lit = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      ctx.clearRect(0, 0, COLS * cellSize, ROWS * cellSize);
      const r = cellSize * 0.4;
      on.forEach((key) => {
        const [row, col] = key.split(",").map(Number);
        ctx.beginPath();
        ctx.arc(col * cellSize + cellSize / 2, row * cellSize + cellSize / 2, r, 0, Math.PI * 2);
        ctx.fillStyle = lit;
        ctx.fill();
      });
    };

    // Once the report is actually ready, freeze on the finish pose
    // instead of continuing to dance — "still working" should stop
    // reading as "still working" the moment it isn't true anymore.
    if (done) {
      drawFrame(tadaPose);
      return;
    }

    let actIndex = 0;
    let frameIndex = 0;
    let actElapsedMs = 0;

    drawFrame(routine[actIndex].frames[frameIndex]);
    const timer = setInterval(() => {
      const act = routine[actIndex];
      frameIndex++;
      if (frameIndex >= act.frames.length) frameIndex = 0;
      actElapsedMs += FRAME_MS;
      if (actElapsedMs >= act.loopMs) {
        actIndex = (actIndex + 1) % routine.length;
        frameIndex = 0;
        actElapsedMs = 0;
      }
      drawFrame(routine[actIndex].frames[frameIndex]);
    }, FRAME_MS);

    return () => clearInterval(timer);
  }, [cellSize, done]);

  // inline-block, not block — the parent's text-center only centers
  // inline content, and this is meant to be dropped into text-centered
  // interstitial copy without its own wrapper/margin auto.
  return <canvas ref={canvasRef} style={{ display: "inline-block", imageRendering: "pixelated" }} />;
}
