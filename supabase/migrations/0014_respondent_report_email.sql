-- Supports the automated "your report is ready" email sent to respondents:
-- a random, unguessable token (not the submission id itself, which already
-- appears in several other URLs) gates a token-only PDF download route,
-- since the email recipient isn't necessarily logged into the app when they
-- click it. pdf_downloaded_at is set once, on first successful download —
-- a more reliable "did they actually get the report" signal than an
-- email-open tracking pixel, which Apple Mail Privacy Protection and
-- various client-side image proxies fire regardless of whether a human
-- actually looked at the email.
alter table public.nss_submissions
  add column if not exists pdf_download_token text,
  add column if not exists pdf_downloaded_at timestamptz;
