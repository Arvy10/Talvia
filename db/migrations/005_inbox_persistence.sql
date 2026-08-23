-- Persisted Talvia Inbox on top of the conversation tables created in 001.
begin;

alter table conversations alter column connection_id drop not null;
alter table conversations alter column external_thread_id drop not null;
alter table conversations add column if not exists provider_conversation_id text;
alter table conversations add column if not exists archived_at timestamptz;

alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check check (status in ('draft','pending','sent','delivered','failed','read','received'));
alter table messages add column if not exists updated_at timestamptz not null default now();

create table if not exists conversation_member_states (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);

create index if not exists conversations_workspace_inbox_idx on conversations(workspace_id, archived_at, last_message_at desc nulls last);
create index if not exists conversations_workspace_channel_idx on conversations(workspace_id, channel_type, archived_at);
create index if not exists conversation_participants_contact_idx on conversation_participants(contact_id, conversation_id);
create index if not exists messages_conversation_created_idx on messages(conversation_id, created_at asc);
create unique index if not exists messages_provider_message_unique on messages(conversation_id, provider_message_id) where provider_message_id is not null;

commit;
