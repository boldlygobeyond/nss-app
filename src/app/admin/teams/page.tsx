"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert, Users, Upload, Check, FileSpreadsheet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { parseRosterCsv, rosterRowsFromGrid, type RosterRow } from "@/lib/nss/rosterCsv";
import { pickRosterFromGoogleSheets } from "@/lib/nss/googlePicker";
import GlobalHeader from "@/components/GlobalHeader";

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  rosterCount: number;
}

export default function TeamsPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [teams, setTeams] = useState<TeamRow[]>([]);

  const [name, setName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pickingFromDrive, setPickingFromDrive] = useState(false);

  const loadTeams = async () => {
    const supabase = createClient();
    const { data: teamRows } = await supabase.from("teams").select("id, name, slug, created_at").order("created_at", { ascending: false });
    const { data: rosterRows } = await supabase.from("team_roster").select("team_id");
    const counts = new Map<string, number>();
    (rosterRows ?? []).forEach((r) => counts.set(r.team_id, (counts.get(r.team_id) ?? 0) + 1));
    setTeams((teamRows ?? []).map((t) => ({ ...t, rosterCount: counts.get(t.id) ?? 0 })));
  };

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
      const myProfile = await getMyProfile(supabase, user.id);
      if (myProfile?.role !== "admin") {
        setLoading(false);
        return;
      }
      setAuthorized(true);
      await loadTeams();
      setLoading(false);
    };
    load();
  }, []);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { rows: parsed, errors } = parseRosterCsv(text);
    setFileName(file.name);
    setRows(parsed);
    setParseErrors(errors);
  };

  const handlePickFromDrive = async () => {
    setPickingFromDrive(true);
    setParseErrors([]);
    try {
      const result = await pickRosterFromGoogleSheets();
      if (!result) return; // user closed the picker without choosing anything
      const { rows: parsed, errors } = rosterRowsFromGrid(result.grid);
      setFileName(result.fileName);
      setRows(parsed);
      setParseErrors(errors);
    } catch (err) {
      setParseErrors([err instanceof Error ? err.message : "Could not load that spreadsheet."]);
    } finally {
      setPickingFromDrive(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || rows.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/nss/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), rows }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not create the team.");
      }
      setName("");
      setFileName(null);
      setRows([]);
      setParseErrors([]);
      await loadTeams();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the team.");
    } finally {
      setCreating(false);
    }
  };

  const inputClass =
    "h-10 rounded-lg bg-background border border-border/50 focus:border-primary focus:outline-none px-3 text-sm w-full";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="max-w-3xl mx-auto px-6 py-12 w-full">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-1">Teams</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Set up a pilot team from a spreadsheet, then invite, track, and report on them from their own workspace.
        </p>

        {loading ? (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authorized ? (
          <div className="bg-card border border-border/50 rounded-2xl p-10 text-center">
            <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You don&apos;t have access to this page.</p>
          </div>
        ) : (
          <>
            <div className="bg-card border border-border/50 rounded-2xl p-6 mb-10">
              <h2 className="font-heading text-sm font-semibold text-foreground mb-4">New team</h2>
              <input
                className={`${inputClass} mb-3`}
                placeholder="Team name (e.g. WI LGBT Chamber of Commerce)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <div className="flex items-stretch gap-2 mb-2">
                <label className="flex-1 flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-border/50 text-sm text-muted-foreground cursor-pointer hover:bg-background transition-colors">
                  <Upload className="w-4 h-4 shrink-0" />
                  {fileName ?? "Upload roster CSV"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={handlePickFromDrive}
                  disabled={pickingFromDrive}
                  className="flex items-center gap-2 h-10 px-3 rounded-lg border border-border/50 text-sm text-muted-foreground hover:bg-background transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {pickingFromDrive ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 shrink-0" />
                  )}
                  Select from Drive
                </button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Columns: first_name, last_name, email, manager_email (a few header spellings are fine).
              </p>

              {parseErrors.length > 0 && (
                <ul className="text-xs text-destructive mb-2 list-disc pl-4">
                  {parseErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
              {rows.length > 0 && (
                <p className="text-xs text-muted-foreground mb-4 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-primary" /> {rows.length} {rows.length === 1 ? "person" : "people"}{" "}
                  ready to load
                </p>
              )}

              <button
                onClick={handleCreate}
                disabled={creating || !name.trim() || rows.length === 0}
                className="h-10 px-4 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create team"}
              </button>
              {createError && <p className="text-xs text-destructive mt-2">{createError}</p>}
            </div>

            <h2 className="font-heading text-sm font-semibold text-foreground mb-3">Existing teams</h2>
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet.</p>
            ) : (
              <div className="space-y-2">
                {teams.map((t) => (
                  <Link
                    key={t.id}
                    href={`/admin/teams/${t.slug}`}
                    className="flex items-center justify-between gap-4 bg-card border border-border/50 rounded-xl p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.rosterCount} {t.rosterCount === 1 ? "person" : "people"}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
