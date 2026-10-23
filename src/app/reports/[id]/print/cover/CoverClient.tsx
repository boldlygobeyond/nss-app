"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";
import { INTRO_TEXT } from "@/lib/nss/reportTypes";
import NeedsClusterReference from "@/components/reports/NeedsClusterReference";

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
    // No CSS page padding and no footer here — this is always rendered as
    // the first section of one continuous capture (see
    // print/combined/CombinedClient.tsx), so the PDF capture's own
    // physical page margin and single shared footerTemplate cover it, same
    // as every other page. print:break-after-page starts a fresh page
    // before the body content that follows it in that combined capture.
    <div className="print-light bg-white flex flex-col print:break-after-page">
      <Image src="/logo/bgb-line-all-color.png" alt="Boldly Go Beyond" width={220} height={22} priority className="mb-4" />

      <h1 className="font-heading text-[2.25rem] leading-tight font-bold text-foreground mb-2">Needs Signal Report</h1>
      <div className="h-1 w-14 rounded-full bg-accent mb-4" />

      <p className="text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase mb-1">Prepared for</p>
      <p className="text-xl font-bold text-foreground mb-0.5">{fullName}</p>
      <p className="text-sm text-muted-foreground mb-4">
        {new Date(submission.updated_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>

      <h2 className="font-heading text-xl font-bold text-foreground mb-2">
        You aren&apos;t static. Neither are your workplace needs.
      </h2>
      <p className="text-muted-foreground leading-relaxed mb-4">
        Traditional personality tests treat you as fixed and unchanging. But what you need to thrive evolves over
        time and shifts across different environments. Our Needs Signal Survey gives you a real-time snapshot of
        what&apos;s important to you right now and provides concrete insights for helping you meet your needs.
      </p>

      <div className="mb-4">
        <NeedsClusterReference />
      </div>

      <p className="text-muted-foreground leading-relaxed">{INTRO_TEXT}</p>
    </div>
  );
}
