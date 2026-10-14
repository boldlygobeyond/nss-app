-- Resend's own open/click tracking, pulled into our own data via a
-- webhook, so "opened but never clicked" is a visible middle state
-- between "no engagement" and "actually downloaded" (pdf_email_downloaded_at),
-- rather than losing that signal to Resend's own dashboard only.
alter table public.nss_submissions
  add column if not exists email_opened_at timestamptz,
  add column if not exists email_clicked_at timestamptz;
