-- Phase 2: candidates get the two fields Unipile already returns but the
-- previous prospecting pass never persisted (location, current role/title) —
-- both are real data qualification needs and shouldn't have to be re-fetched.
-- `qualification` bundles score/fit/reasons/uncertainties as one jsonb
-- column, same shape convention as business_contexts' ScoredField columns,
-- rather than five separate columns for one cohesive, always-written-together
-- fact.
begin;

alter table campaign_prospect_candidates add column if not exists location text;
alter table campaign_prospect_candidates add column if not exists role text;
alter table campaign_prospect_candidates add column if not exists qualification jsonb;

commit;
