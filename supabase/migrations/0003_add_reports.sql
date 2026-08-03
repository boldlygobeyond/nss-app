-- Add AI-generated report storage to nss_submissions.

alter table public.nss_submissions
  add column employee_report text,
  add column manager_report text;
