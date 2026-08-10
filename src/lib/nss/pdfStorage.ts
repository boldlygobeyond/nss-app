// Caches each submission's rendered report PDF in a private Supabase
// Storage bucket, so "Download PDF" can serve the same bytes generated at
// report-completion time instead of re-rendering through headless Chromium
// on every click. Keyed by submission id — regenerating a report (force)
// overwrites the cached copy via upsert.

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "nss-reports";

function objectPath(submissionId: string): string {
  return `${submissionId}.pdf`;
}

export async function getCachedReportPdf(
  admin: SupabaseClient,
  submissionId: string,
): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(objectPath(submissionId));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function cacheReportPdf(
  admin: SupabaseClient,
  submissionId: string,
  pdfBuffer: Buffer,
): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).upload(objectPath(submissionId), pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
}
