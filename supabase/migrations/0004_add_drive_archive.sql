-- Track the Google Drive backup copies of generated reports.

alter table public.nss_submissions
  add column employee_pdf_url text,
  add column employee_pdf_drive_id text,
  add column manager_pdf_url text,
  add column manager_pdf_drive_id text;
