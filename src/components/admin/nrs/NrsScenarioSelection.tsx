"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ClusterKey } from "@/lib/nrs/clusters";

const REQUIRED_COUNT = 10;

interface ScenarioRow {
  id: number;
  needLabel: string;
  scenarioText: string;
  order: number;
}

interface NeedGroup {
  needLabel: string;
  scenarios: ScenarioRow[];
}

export default function NrsScenarioSelection({
  teamId,
  clusterKey,
  collapsed,
  onToggleCollapsed,
  onSelectionStatusChange,
}: {
  teamId: string;
  clusterKey: ClusterKey;
  // Controlled by the parent so it can auto-collapse this section (and
  // open the invite section instead) once a valid selection exists —
  // either already saved from before, or just saved this session.
  collapsed: boolean;
  onToggleCollapsed: () => void;
  // Lets the parent (the invite-sending section of this same tab) know
  // whether there's currently a valid saved selection, without it having
  // to duplicate this component's own fetch.
  onSelectionStatusChange?: (status: { hasValidSelection: boolean; locked: boolean }) => void;
}) {
  const [questions, setQuestions] = useState<ScenarioRow[] | null>(null);
  const [savedIds, setSavedIds] = useState<number[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setQuestions(null);
      setSaveError(null);
      setJustSaved(false);
      const supabase = createClient();

      const [{ data: questionRows }, { data: selectionRow }, { data: lockRows }] = await Promise.all([
        supabase
          .from("nrs_questions")
          .select("id, need_label, scenario_text, display_order")
          .eq("cluster_key", clusterKey)
          .order("display_order"),
        supabase
          .from("nrs_team_cluster_scenarios")
          .select("question_ids")
          .eq("team_id", teamId)
          .eq("cluster_key", clusterKey)
          .maybeSingle(),
        supabase
          .from("nrs_submissions")
          .select("id, team_roster!inner(team_id)")
          .eq("cluster_key", clusterKey)
          .eq("team_roster.team_id", teamId)
          .limit(1),
      ]);
      if (cancelled) return;

      const loadedSavedIds: number[] | null = selectionRow?.question_ids ?? null;
      const isLocked = (lockRows?.length ?? 0) > 0;

      setQuestions(
        (questionRows ?? []).map((q) => ({
          id: q.id,
          needLabel: q.need_label,
          scenarioText: q.scenario_text,
          order: q.display_order,
        })),
      );
      setSavedIds(loadedSavedIds);
      setSelectedIds(new Set(loadedSavedIds ?? []));
      setLocked(isLocked);
      onSelectionStatusChange?.({ hasValidSelection: loadedSavedIds !== null, locked: isLocked });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, clusterKey]);

  const needGroups: NeedGroup[] = useMemo(() => {
    if (!questions) return [];
    const groups: NeedGroup[] = [];
    const byNeed = new Map<string, ScenarioRow[]>();
    for (const q of questions) {
      if (!byNeed.has(q.needLabel)) {
        byNeed.set(q.needLabel, []);
        groups.push({ needLabel: q.needLabel, scenarios: byNeed.get(q.needLabel)! });
      }
      byNeed.get(q.needLabel)!.push(q);
    }
    return groups;
  }, [questions]);

  const hasUnsavedChanges = useMemo(() => {
    const saved = [...(savedIds ?? [])].sort((a, b) => a - b);
    const current = [...selectedIds].sort((a, b) => a - b);
    return JSON.stringify(saved) !== JSON.stringify(current);
  }, [savedIds, selectedIds]);

  const toggleScenario = (id: number) => {
    if (locked) return;
    setJustSaved(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= REQUIRED_COUNT) return prev; // prevent selecting more than 10
        next.add(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/nrs/team-scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, clusterKey, questionIds: [...selectedIds] }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSaveError(body.error || "Could not save this selection.");
        return;
      }
      setSavedIds(body.questionIds);
      setJustSaved(true);
      onSelectionStatusChange?.({ hasValidSelection: true, locked });
    } catch {
      setSaveError("Could not save this selection. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!questions) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <button
          onClick={onToggleCollapsed}
          className="flex items-center gap-1.5 font-heading text-sm font-semibold text-foreground"
        >
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          Scenario Selection
        </button>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium tabular-nums ${selectedIds.size === REQUIRED_COUNT ? "text-primary" : "text-muted-foreground"}`}>
            {selectedIds.size} of {REQUIRED_COUNT} selected
          </span>
        </div>
      </div>

      {!collapsed && (
        <>
          {locked && (
            <div className="flex items-center gap-2 mt-3 mb-4 px-3 py-2 rounded-lg bg-secondary/60 border border-border/50">
              <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">
                This selection is locked — invitations have already been sent for this team and cluster, so it can
                no longer be changed.
              </p>
            </div>
          )}
          {!locked && selectedIds.size < REQUIRED_COUNT && (
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              {`${REQUIRED_COUNT - selectedIds.size} more scenario${REQUIRED_COUNT - selectedIds.size === 1 ? "" : "s"} needed before you can save. Invitations can't be sent for this cluster until a selection of exactly 10 is saved.`}
            </p>
          )}
          {saveError && <p className="text-xs text-destructive mt-2 mb-4">{saveError}</p>}

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            {needGroups.map((group) => {
              const selectedInGroup = group.scenarios.filter((s) => selectedIds.has(s.id)).length;
              return (
                <div key={group.needLabel}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-foreground">{group.needLabel}</p>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{selectedInGroup}/3</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {group.scenarios.map((s) => (
                      <label
                        key={s.id}
                        className={`flex items-start gap-2 text-xs leading-relaxed rounded-lg px-2 py-1.5 ${
                          locked ? "" : "cursor-pointer hover:bg-secondary/60"
                        } ${selectedIds.has(s.id) ? "bg-primary/10" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleScenario(s.id)}
                          disabled={locked}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="text-foreground">{s.scenarioText}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {!locked && (
            <div className="flex items-center justify-end gap-3 mt-5">
              {hasUnsavedChanges && !justSaved && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Unsaved changes</span>
              )}
              {justSaved && !hasUnsavedChanges && <span className="text-xs text-primary font-medium">Saved</span>}
              <button
                onClick={handleSave}
                disabled={selectedIds.size !== REQUIRED_COUNT || !hasUnsavedChanges || saving}
                className="h-8 px-3 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {saving ? "Saving..." : "Save Selection"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
