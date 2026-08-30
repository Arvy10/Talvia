-- Phase 3: per-participant personalization state — evidence used, the
-- proposed outreach angle, and the invitation note / message texts through
-- their generated -> edited -> approved lifecycle. One jsonb column, same
-- convention as campaign_prospect_candidates.qualification: this is one
-- cohesive object always read/written together, not five columns that
-- would need to stay in sync by hand.
--
-- `messages` inside this object is an array keyed by campaign_steps id, not
-- a single object — today only one 'message' step exists per prospecting
-- campaign, but this shape needs no further migration when a future
-- follow-up step is added (docs spec §14).
begin;

alter table campaign_participants add column if not exists personalization jsonb;

commit;
