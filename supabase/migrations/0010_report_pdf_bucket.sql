-- Private bucket for caching each submission's rendered report PDF, so
-- "Download PDF" can serve the same bytes generated at report-completion
-- time instead of re-rendering through headless Chromium on every click.
-- Only the service-role client touches this bucket, so no storage.objects
-- RLS policies are needed — service role bypasses them by default.

insert into storage.buckets (id, name, public)
values ('nss-reports', 'nss-reports', false)
on conflict (id) do nothing;
