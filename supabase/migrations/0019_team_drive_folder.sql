-- Captured when a roster is picked from Google Drive (the sheet's parent
-- folder — e.g. Clients/WI LGBT Chamber of Commerce) — that team's reports
-- get archived into an "NSS Reports" subfolder inside this one instead of
-- the default NSS_Reports/{email}/ structure. Null for a CSV-uploaded
-- team, which just keeps using the default location.
alter table public.teams add column drive_folder_id text;
