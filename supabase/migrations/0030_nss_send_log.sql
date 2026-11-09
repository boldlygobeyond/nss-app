-- NSS's email-send audit trail — mirrors nrs_send_log (0022), closing the
-- gap flagged during the NRS pilot-readiness review: NSS's 4 email files
-- (admin notification, respondent report, team invite, team report ready)
-- each called Resend directly with no log of what was actually attempted,
-- no record of success/failure, and no dev-mode safety gate.
--
-- Unlike NRS, where every email type is cleanly anchored to one
-- nrs_submissions row, NSS's 4 types don't share a single natural key:
-- a team invite happens before any nss_submissions row exists (it's
-- anchored to a team_roster row instead, if one exists at all — the
-- one-off invite form doesn't require one), while the report-ready and
-- respondent-report emails ARE anchored to a submission, and the admin
-- notification is anchored to neither. So submission_id and roster_id are
-- both nullable, at most one is ever set depending on email_type, and
-- recipient_email is the one column every row always has — the actual
-- email address is recoverable here even for the admin-notification type,
-- which isn't tied to any other NSS table at all.
create table public.nss_send_log (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  email_type text not null check (
    email_type in ('admin_notification', 'respondent_report', 'team_invite', 'team_report_ready')
  ),
  outcome text not null check (outcome in ('sent', 'mocked', 'failed')),
  error_message text,
  resend_message_id text,
  submission_id uuid references public.nss_submissions (id) on delete set null,
  roster_id uuid references public.team_roster (id) on delete set null,
  -- Null for a participant-triggered send (a respondent finishing their
  -- own survey) or a webhook-triggered one (first-signup notification) —
  -- only ever set for an admin-initiated send (team invite).
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index nss_send_log_submission_id_idx on public.nss_send_log (submission_id);
create index nss_send_log_roster_id_idx on public.nss_send_log (roster_id, email_type);

alter table public.nss_send_log enable row level security;

-- Admin-only, same model as nrs_send_log — every write goes through the
-- service-role client from server-side send paths; this policy exists so
-- an ordinary authenticated (non-admin) user can't read anyone else's
-- email history, not to grant any participant access.
create policy "nss_send_log_admin_only" on public.nss_send_log
  for all using (public.is_admin()) with check (public.is_admin());
