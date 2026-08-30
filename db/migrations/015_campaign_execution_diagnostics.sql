-- Campaign execution engine, phase 1: per-participant diagnosability
-- (see docs/product/ARCHITECTURE.md §6 and the chat record this was built
-- from). Nothing here changes what a participant IS — only lets the engine
-- record *why* its last attempted action was skipped or failed, so "sent=0"
-- is never a silent mystery.
begin;

alter table campaign_participants add column if not exists last_error_code varchar(32);
alter table campaign_participants add column if not exists last_error_at timestamptz;

commit;
