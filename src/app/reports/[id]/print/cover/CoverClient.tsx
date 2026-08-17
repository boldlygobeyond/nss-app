"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";
import { INTRO_TEXT } from "@/lib/nss/reportTypes";

export default function CoverClient({ id }: { id: string }) {
  const [submission, setSubmission] = useState<NssSubmission | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const row = await getSubmission(supabase, id);
      setSubmission(row);
      if (row) {
        const profile = await getMyProfile(supabase, row.user_id).catch(() => null);
        setFullName(buildFullName(profile?.first_name, profile?.last_name, row.respondent_name));
      }
    };
    load();
  }, [id]);

  if (!submission) return null;

  return (
    // Explicit physical height instead of min-h-screen/vh — Chromium's
    // print pipeline lays vh units out against the pre-print screen
    // viewport, not the actual paper page, so a vh-based "pin to bottom"
    // trick doesn't reliably reach the real page edge. 267mm = A4's 297mm
    // minus the 15mm top/bottom margins set on this capture in
    // pdfRender.ts, i.e. exactly the printable content height.
    <div className="print-light bg-white flex flex-col px-16 py-12" style={{ minHeight: "267mm" }}>
      <div className="flex flex-col items-center text-center mt-2 mb-10">
        <div className="h-1 w-10 rounded-full bg-primary mb-8" />
        <Image src="/logo/bgb-line-all-color.png" alt="Boldly Go Beyond" width={300} height={30} priority className="mb-8" />
        <h1 className="font-heading text-4xl font-bold text-foreground mb-4">Needs Signal Report</h1>
        <div className="h-[3px] w-16 rounded-full bg-accent mb-14" />
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase mb-2">Prepared for</p>
        <p className="text-2xl font-semibold text-foreground mb-1">{fullName}</p>
        <p className="text-sm text-muted-foreground">
          {new Date(submission.updated_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <div className="max-w-xl mx-auto text-center border border-border/50 rounded-xl p-8">
          <h2 className="font-heading text-2xl font-bold text-foreground mb-4">
            You aren&apos;t static. Neither are your workplace needs.
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Traditional personality tests treat you as fixed and unchanging. But what you need to thrive evolves
            over time and shifts across different environments. Our Needs Signal Survey gives you a real-time
            snapshot of what&apos;s important to you right now and provides concrete signals to let you know when
            your needs are met or unmet.
          </p>
        </div>
      </div>

      <div className="p-5 rounded-r-lg border-l-4 border-accent bg-accent/5 text-sm text-foreground italic leading-relaxed max-w-2xl mx-auto w-full">
        {INTRO_TEXT}
      </div>
    </div>
  );
}
