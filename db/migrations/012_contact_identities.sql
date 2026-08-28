-- Per-channel identity references for a Contact (ARCHITECTURE.md §2 "Contact Identities").
-- Lets provider webhooks resolve an inbound sender to an existing Contact across
-- conversations instead of creating a duplicate Contact per channel.
create table contact_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  provider varchar(64) not null,
  channel_type varchar(24) not null check (channel_type in ('linkedin','whatsapp','email','instagram','other')),
  external_id text not null,
  display_label text,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);
create index contact_identities_contact_idx on contact_identities(contact_id);
