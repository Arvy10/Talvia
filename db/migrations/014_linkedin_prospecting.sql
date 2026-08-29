-- Supervised LinkedIn prospecting: search Business-Context-matched candidates,
-- human approves the list, invitations go out in manually-triggered batches
-- (see docs/product/DECISIONS.md and the chat record for why this is
-- supervised/manual rather than autonomous/scheduled for V1).
begin;

alter table campaign_steps drop constraint if exists campaign_steps_step_type_check;
alter table campaign_steps add constraint campaign_steps_step_type_check
  check (step_type in ('invite','message','wait','follow_up','end'));

-- AI-suggested candidates for a prospecting campaign, before any human
-- review — never sent to, never a Contact, until approved. Rejected/ignored
-- candidates stay here for audit instead of being deleted.
create table campaign_prospect_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  provider_id text not null,
  profile_url text,
  name text not null,
  headline text,
  company text,
  status varchar(24) not null default 'suggested' check (status in ('suggested','approved','rejected')),
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(campaign_id, provider_id)
);
create index campaign_prospect_candidates_campaign_idx on campaign_prospect_candidates(campaign_id, status);

-- Invite pacing/acceptance tracking on the existing participant row — a
-- prospecting campaign_participant IS a participant, same as any other
-- campaign type; this just adds what LinkedIn invitations specifically need.
-- invite_claimed_at is a short-lived claim marker (see sendInviteBatch's
-- SELECT...FOR UPDATE SKIP LOCKED claim, mirroring
-- app/lib/acquisition/scheduler.ts's claim-then-send-outside-the-transaction
-- pattern) — distinct from invite_sent_at, which is only ever set after
-- Unipile actually confirms the send (never fabricate a successful provider
-- action, per docs/product/ARCHITECTURE.md §9).
alter table campaign_participants add column if not exists invite_claimed_at timestamptz;
alter table campaign_participants add column if not exists invite_sent_at timestamptz;
alter table campaign_participants add column if not exists invite_accepted_at timestamptz;

commit;
