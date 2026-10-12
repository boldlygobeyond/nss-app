-- Distinguishes "downloaded from the in-app report page" from "downloaded
-- via the emailed link" — these were about to collide into one column now
-- that both paths need independent tracking (the CRM wants to show both
-- signals separately for a lead).
alter table public.nss_submissions
  rename column pdf_downloaded_at to pdf_email_downloaded_at;

alter table public.nss_submissions
  add column if not exists pdf_portal_downloaded_at timestamptz;
