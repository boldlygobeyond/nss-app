"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { computeInsightsData, type InsightsData, type JourneyEntry } from "@/lib/nss/insightsData";
import type { ClusterKey } from "@/lib/nss/clusters";
import GlobalHeader from "@/components/GlobalHeader";

function clusterCode(c: ClusterKey | null): string {
  return c ? c.slice(0, 3).toUpperCase() : "—";
}

function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join("|");
}

const STATUS_STYLES: Record<JourneyEntry["status"], string> = {
  answered: "bg-secondary text-muted-foreground border-transparent",
  it_depends_then_answered: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/60",
  skipped:
    "text-muted-foreground border-transparent bg-[repeating-linear-gradient(135deg,theme(colors.secondary.DEFAULT)_0,theme(colors.secondary.DEFAULT)_3px,theme(colors.border.DEFAULT)_3px,theme(colors.border.DEFAULT)_6px)]",
};

const TIER_UNDERLINE: Record<string, string> = {
  staleness: "shadow-[inset_0_-2.5px_0_0_#ef4444]",
  validation: "shadow-[inset_0_-2.5px_0_0_#f59e0b]",
  default: "shadow-[inset_0_-2.5px_0_0_theme(colors.primary.DEFAULT)]",
  "guard-relaxed": "shadow-[inset_0_-2.5px_0_0_#a855f7]",
};

function JourneyCell({
  entry,
  flash,
  onSelect,
  cellRef,
}: {
  entry: JourneyEntry;
  flash: boolean;
  onSelect: () => void;
  cellRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={cellRef}
      onClick={onSelect}
      title={`Q${entry.position} · ${entry.pair}`}
      className={`relative w-7 h-7 rounded-md border text-[9px] font-mono font-medium flex items-center justify-center transition-transform ${STATUS_STYLES[entry.status]} ${
        entry.tier ? TIER_UNDERLINE[entry.tier] ?? "" : ""
      } ${flash ? "scale-125 ring-2 ring-primary" : "hover:scale-110 hover:ring-2 hover:ring-primary/60"}`}
    >
      {clusterCode(entry.chosenCluster)}
    </button>
  );
}

export default function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState<InsightsData | null>(null);

  const [selectedEntry, setSelectedEntry] = useState<JourneyEntry | null>(null);
  const [matrixPair, setMatrixPair] = useState<[ClusterKey, ClusterKey] | null>(null);
  const [flashPosition, setFlashPosition] = useState<number | null>(null);
  const [hoverN, setHoverN] = useState<number | null>(null);

  const cellRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const profile = await getMyProfile(supabase, user.id);
      if (profile?.role !== "admin") {
        setLoading(false);
        return;
      }
      setAuthorized(true);
      const insights = await computeInsightsData(supabase, id);
      setData(insights);
      setLoading(false);
    };
    load();
  }, [id]);

  const journeyByPosition = useMemo(() => {
    const m = new Map<number, JourneyEntry>();
    data?.journey.forEach((e) => m.set(e.position, e));
    return m;
  }, [data]);

  const jumpTo = (position: number) => {
    const el = cellRefs.current[position];
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashPosition(position);
    window.setTimeout(() => setFlashPosition(null), 1100);
    const entry = journeyByPosition.get(position);
    if (entry) setSelectedEntry(entry);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GlobalHeader />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GlobalHeader />
        <div className="max-w-2xl mx-auto px-6 py-12 w-full">
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <GlobalHeader />
        <div className="max-w-2xl mx-auto px-6 py-12 w-full">
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No survey journey to show yet — this submission may not have started answering questions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const calibrationCells = data.journey.filter((e) => e.phase === "calibration");
  const adaptiveCells = data.journey.filter((e) => e.phase === "adaptive");
  const clusters = Object.keys(data.clusterLabels) as ClusterKey[];
  const maxCount = Math.max(1, ...clusters.flatMap((a) => clusters.map((b) => data.matrix[a][b])));

  // ── confidence trajectory geometry ──
  const traj = data.trajectory;
  const W = 460,
    H = 180,
    padL = 32,
    padR = 10,
    padT = 10,
    padB = 20;
  const xMin = traj[0]?.n ?? 0;
  const xMax = traj[traj.length - 1]?.n ?? 1;
  const xPos = (n: number) => padL + ((n - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const yPos = (s: number) => padT + (1 - s) * (H - padT - padB);
  const pathD = "M " + traj.map((p) => `${xPos(p.n)} ${yPos(p.stability)}`).join(" L ");
  const areaD = `${pathD} L ${xPos(xMax)} ${yPos(0)} L ${xPos(xMin)} ${yPos(0)} Z`;
  const changeMarks: number[] = [];
  for (let i = 1; i < traj.length; i++) {
    if (JSON.stringify(traj[i].top3) !== JSON.stringify(traj[i - 1].top3)) changeMarks.push(traj[i].n);
  }
  const nearestTrajPoint = (n: number) =>
    traj.reduce((closest, p) => (Math.abs(p.n - n) < Math.abs(closest.n - n) ? p : closest), traj[0]);
  const hoverPoint = hoverN != null ? nearestTrajPoint(hoverN) : null;
  const lastTraj = traj[traj.length - 1];

  const handleChartMouseMove: React.MouseEventHandler<SVGRectElement> = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const n = xMin + ((svgX - padL) / (W - padL - padR)) * (xMax - xMin);
    setHoverN(n);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-4xl mx-auto px-6 py-12 w-full">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>

        <p className="text-xs font-semibold tracking-wide uppercase text-primary mb-1">Insights · under the hood</p>
        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">{data.respondentName}&apos;s journey</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Every question they saw, how the delivery logic picked it, and where their needs ranking landed. Click any
          question to read it.
        </p>

        {/* stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/50 border border-border/50 rounded-xl overflow-hidden mb-8">
          <div className="bg-card p-4">
            <p className="text-2xl font-semibold text-foreground tabular-nums">{data.totalQuestions}</p>
            <p className="text-xs text-muted-foreground mt-1">questions answered</p>
          </div>
          <div className="bg-card p-4">
            <p className="text-2xl font-semibold text-foreground tabular-nums">{data.itDependsCount}</p>
            <p className="text-xs text-muted-foreground mt-1">&quot;it depends&quot; first</p>
          </div>
          <div className="bg-card p-4">
            <p className="text-2xl font-semibold text-foreground tabular-nums">{data.skippedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">skipped entirely</p>
          </div>
          <div className="bg-card p-4">
            <p className="text-sm font-semibold text-foreground">
              {lastTraj ? lastTraj.top3.map((c) => data.clusterLabels[c]).join(" · ") : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">final top 3</p>
          </div>
        </div>

        {/* journey strip */}
        <section className="mb-8">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-sm font-semibold text-foreground">Question-by-question journey</h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-secondary border border-border" /> Answered
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/15 border border-amber-500/60" /> It depends →
                answered
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,theme(colors.secondary.DEFAULT)_0,theme(colors.secondary.DEFAULT)_2px,theme(colors.border.DEFAULT)_2px,theme(colors.border.DEFAULT)_4px)]" />{" "}
                Skipped
              </span>
            </div>
          </div>
          <div className="bg-card border border-border/50 rounded-2xl p-5">
            <p className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground mb-2">
              Calibration — fixed 21-question sequence
            </p>
            <div className="flex flex-wrap gap-1 mb-5">
              {calibrationCells.map((entry) => (
                <JourneyCell
                  key={entry.position}
                  entry={entry}
                  flash={flashPosition === entry.position}
                  onSelect={() => setSelectedEntry(entry)}
                  cellRef={(el) => {
                    cellRefs.current[entry.position] = el;
                  }}
                />
              ))}
            </div>
            <p className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground mb-2">
              Adaptive {data.usesNewBank ? "— picked live by the delivery logic" : "— v1 win-rate selection"}
            </p>
            <div className="flex flex-wrap gap-1 mb-4">
              {adaptiveCells.map((entry) => (
                <JourneyCell
                  key={entry.position}
                  entry={entry}
                  flash={flashPosition === entry.position}
                  onSelect={() => setSelectedEntry(entry)}
                  cellRef={(el) => {
                    cellRefs.current[entry.position] = el;
                  }}
                />
              ))}
            </div>
            {data.usesNewBank ? (
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap pt-3 border-t border-border/50">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm shadow-[inset_0_-2.5px_0_0_#ef4444] border border-border" />{" "}
                  staleness tier
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm shadow-[inset_0_-2.5px_0_0_#f59e0b] border border-border" />{" "}
                  validation tier
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm shadow-[inset_0_-2.5px_0_0_theme(colors.primary.DEFAULT)] border border-border" />{" "}
                  default tier
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground pt-3 border-t border-border/50">
                This respondent took the original 50-question bank, which picked questions in blocks of 7 by
                win-rate rather than one at a time — so there&apos;s no per-question tier to show here.
              </p>
            )}
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-5 mb-8">
          {/* cluster matrix */}
          <section className="bg-card border border-border/50 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Cluster head-to-head</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Row beat column, this many times. Click a cell to see which questions.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono tabular-nums">
                <thead>
                  <tr>
                    <th />
                    {clusters.map((c) => (
                      <th key={c} title={data.clusterLabels[c]} className="font-medium text-muted-foreground p-1">
                        {clusterCode(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((rowC) => (
                    <tr key={rowC}>
                      <th title={data.clusterLabels[rowC]} className="font-medium text-muted-foreground p-1 text-right pr-2 whitespace-nowrap">
                        {clusterCode(rowC)}
                      </th>
                      {clusters.map((colC) => {
                        if (rowC === colC) return <td key={colC} className="p-1 text-center min-w-[26px]" />;
                        const v = data.matrix[rowC][colC] || 0;
                        const alpha = 0.08 + 0.75 * (v / maxCount);
                        return (
                          <td key={colC} className="p-1 text-center min-w-[26px]">
                            <button
                              onClick={() => setMatrixPair([rowC, colC])}
                              className="w-full h-full rounded block py-0.5 hover:outline hover:outline-2 hover:outline-foreground"
                              style={{
                                background: v > 0 ? `color-mix(in srgb, var(--color-primary, #0d9488) ${Math.round(alpha * 100)}%, transparent)` : "transparent",
                                color: alpha > 0.4 ? "white" : undefined,
                              }}
                            >
                              {v}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {matrixPair && (
              <div className="mt-3 p-3 rounded-lg bg-secondary text-xs">
                {(() => {
                  const [a, b] = matrixPair;
                  const beat = data.matrixPositions[a][b] ?? [];
                  const lost = data.matrixPositions[b][a] ?? [];
                  const Chips = ({ positions }: { positions: number[] }) =>
                    positions.length === 0 ? (
                      <span className="italic text-muted-foreground">no instances</span>
                    ) : (
                      <>
                        {positions.map((p) => (
                          <button
                            key={p}
                            onClick={() => jumpTo(p)}
                            className="inline-flex items-center font-mono bg-card border border-border/50 rounded px-2 py-0.5 mr-1.5 mb-1.5 hover:border-primary hover:text-primary"
                          >
                            Q{p}
                          </button>
                        ))}
                      </>
                    );
                  return (
                    <>
                      <div className="mb-3">
                        <p className="text-muted-foreground mb-1.5">
                          <b className="text-foreground">{data.clusterLabels[a]}</b> beat{" "}
                          <b className="text-foreground">{data.clusterLabels[b]}</b> — {beat.length}{" "}
                          {beat.length === 1 ? "time" : "times"}
                        </p>
                        <Chips positions={beat} />
                      </div>
                      <div className="pt-3 border-t border-border/50">
                        <p className="text-muted-foreground mb-1.5">
                          <b className="text-foreground">{data.clusterLabels[a]}</b> lost to{" "}
                          <b className="text-foreground">{data.clusterLabels[b]}</b> — {lost.length}{" "}
                          {lost.length === 1 ? "time" : "times"}
                        </p>
                        <Chips positions={lost} />
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </section>

          {/* confidence trajectory */}
          <section className="bg-card border border-border/50 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Confidence over time</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Bootstrap stability of the top-3 ranking, question by question.
            </p>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              height={H}
              className="font-mono"
              onMouseLeave={() => setHoverN(null)}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                <g key={g}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={yPos(g)}
                    y2={yPos(g)}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text x={padL - 6} y={yPos(g) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                    {Math.round(g * 100)}%
                  </text>
                </g>
              ))}
              {changeMarks.map((n) => (
                <line
                  key={n}
                  x1={xPos(n)}
                  x2={xPos(n)}
                  y1={padT}
                  y2={H - padB}
                  className="stroke-amber-500 cursor-pointer"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  onClick={() => jumpTo(n)}
                />
              ))}
              <path d={areaD} className="fill-primary" opacity={0.08} />
              <path d={pathD} fill="none" className="stroke-primary" strokeWidth={2} />
              <circle cx={xPos(lastTraj?.n ?? 0)} cy={yPos(lastTraj?.stability ?? 0)} r={3} className="fill-primary" />
              {hoverPoint && (
                <>
                  <line
                    x1={xPos(hoverPoint.n)}
                    x2={xPos(hoverPoint.n)}
                    y1={padT}
                    y2={H - padB}
                    className="stroke-foreground"
                    strokeWidth={1}
                  />
                  <circle cx={xPos(hoverPoint.n)} cy={yPos(hoverPoint.stability)} r={3.5} className="fill-foreground" />
                </>
              )}
              {[xMin, Math.round((xMin + xMax) / 2), xMax].map((n) => (
                <text key={n} x={xPos(n)} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                  Q{n}
                </text>
              ))}
              <rect
                x={padL}
                y={padT}
                width={W - padL - padR}
                height={H - padT - padB}
                fill="transparent"
                className="cursor-crosshair"
                onMouseMove={handleChartMouseMove}
              />
            </svg>
            {hoverPoint ? (
              <p className="text-xs text-muted-foreground mt-1">
                <b className="text-foreground font-mono">Q{hoverPoint.n}</b>{" "}
                {hoverPoint.top3.map((c) => data.clusterLabels[c]).join(" · ")} —{" "}
                {Math.round(hoverPoint.stability * 100)}% stable
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Hover the line for the ranking at any point. Dashed markers are where the top-3 set changed — click
                one to jump to that question.
              </p>
            )}
          </section>
        </div>

        {/* top needs */}
        <section className="bg-card border border-border/50 rounded-2xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3">Final needs ranking</h2>
          <ul className="space-y-2">
            {(data.topNeeds ?? []).map((need, i) => (
              <li key={need.cluster} className="flex items-center gap-2.5 text-sm">
                <span className="font-mono text-muted-foreground w-4">{i + 1}</span>
                <span className="w-36 shrink-0">{data.clusterLabels[need.cluster]}</span>
                <span className="flex-1 h-2 rounded-full bg-secondary overflow-hidden min-w-0">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(need.winRate * 100)}%` }}
                  />
                </span>
                <span className="font-mono tabular-nums text-xs text-muted-foreground w-10 text-right">
                  {Math.round(need.winRate * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* detail overlay */}
      {selectedEntry && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-5 z-50"
          onClick={(e) => e.target === e.currentTarget && setSelectedEntry(null)}
        >
          <div className="bg-card border border-border/50 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-xs font-mono text-muted-foreground">
                Q{selectedEntry.position} · {selectedEntry.pair}
              </p>
              <button
                onClick={() => setSelectedEntry(null)}
                className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded px-1.5 py-0.5 text-lg leading-none"
              >
                ×
              </button>
            </div>
            {selectedEntry.text && (
              <>
                <p className="text-base font-medium text-foreground mb-4">{selectedEntry.text.question}</p>
                {selectedEntry.status === "skipped" && (
                  <div className="text-sm bg-secondary rounded-lg px-3 py-2.5 mb-2 text-muted-foreground">
                    No answer recorded — the respondent skipped this one.
                  </div>
                )}
                {(["A", "B"] as const).map((letter) => {
                  const text = selectedEntry.text!;
                  const chosen = selectedEntry.selection === letter;
                  const rejected = selectedEntry.status !== "skipped" && !chosen;
                  return (
                    <div
                      key={letter}
                      className={`flex gap-2.5 px-3 py-2.5 rounded-lg border mb-2 text-sm ${
                        chosen ? "border-primary bg-primary/10" : "border-border/50"
                      } ${rejected ? "opacity-55" : ""}`}
                    >
                      <span
                        className={`font-mono font-semibold text-[11px] w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 ${
                          chosen ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {letter}
                      </span>
                      <span>{letter === "A" ? text.optionA : text.optionB}</span>
                    </div>
                  );
                })}
              </>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              {selectedEntry.status === "skipped"
                ? "Skipped"
                : selectedEntry.status === "it_depends_then_answered"
                  ? 'Said "it depends" first, then answered'
                  : "Answered"}
              {selectedEntry.tier ? (
                <>
                  {" "}
                  · picked by the <b>{selectedEntry.tier}</b> tier
                </>
              ) : selectedEntry.phase === "calibration" ? (
                " · fixed calibration slot"
              ) : null}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
