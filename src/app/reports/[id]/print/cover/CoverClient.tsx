"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";

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
    <div className="print-light min-h-screen bg-white flex flex-col items-center justify-center px-12 text-center">
      <Image src="/logo/bgb-line-all-color.png" alt="Boldly Go Beyond" width={420} height={42} className="mb-16" />
      <h1 className="font-heading text-5xl font-bold text-foreground mb-8">Needs Signal Report</h1>
      <p className="text-2xl font-semibold text-foreground mb-3">{fullName}</p>
      <p className="text-lg text-muted-foreground">
        {new Date(submission.updated_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
    </div>
  );
}
