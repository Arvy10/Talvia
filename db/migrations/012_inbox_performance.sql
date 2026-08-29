-- Inbox performance sprint: every message-ordering query in lib/inbox.ts and
-- lib/providers/unipile-adapter.ts sorts by coalesce(sent_at,received_at,created_at)
-- (real chronology, not DB-insert time — see 005's follow-up fix), but the
-- only index on messages was on plain created_at. That expression was never
-- indexable, so both the conversation list's "last message" lookup and every
-- full message-history fetch forced a sequential scan + sort per conversation.
-- A stored generated column makes the real ordering itself indexable.
begin;

alter table messages add column if not exists effective_time timestamptz
  generated always as (coalesce(sent_at, received_at, created_at)) stored;

drop index if exists messages_conversation_created_idx;
create index if not exists messages_conversation_effective_idx on messages(conversation_id, effective_time);

commit;
