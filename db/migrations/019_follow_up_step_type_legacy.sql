-- Phase 4B §7: documentation-only, purely additive. No behavior change, no
-- data touched, no constraint altered — campaign_steps.step_type keeps
-- accepting 'follow_up' so pre-existing rows keep reading correctly. New
-- code (see app/lib/campaigns.ts's CampaignStepType, and the campaign
-- creation wizard) never writes 'follow_up' again: a follow-up is now
-- created as an ordinary 'message' step, with a preceding 'wait' step and
-- its sequence position being what makes it a "relance" — not a distinct
-- step_type. This comment is the durable record of that decision at the
-- schema level, for anyone reading the table structure directly.
begin;

comment on constraint campaign_steps_step_type_check on campaign_steps is
  'step_type in (invite, message, wait, follow_up, end). follow_up is legacy/deprecated as of Phase 4B — kept only for backward-compatible reads of rows created before that phase. New follow-up steps are created as message steps; WAIT + sequence position determine that a message is a relance, not a separate step_type.';

commit;
