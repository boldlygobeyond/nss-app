-- Replaces the old separate employee_report/manager_report text columns
-- with a single structured report shared verbatim between the employee and
-- their manager (matching the new "NSS Consolidated Report" format — one
-- document, walked through together in a 1:1, rather than two documents).
-- The old text columns and their PDF-archive columns are left in place
-- (unused going forward) rather than dropped, so no historical data is lost.

alter table public.nss_submissions
  add column if not exists report_data jsonb,
  add column if not exists pdf_url text,
  add column if not exists pdf_drive_id text;
