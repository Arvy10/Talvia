-- Talvia opt-in beta acquisition. These global tables deliberately do not
-- belong to a Talvia customer workspace or its commercial CRM.
begin;

create table beta_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  first_name text,
  role text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_url text,
  status varchar(16) not null default 'WAITLIST' check (status in ('WAITLIST','INVITED','ACTIVATED','CUSTOMER','UNSUBSCRIBED')),
  consent_at timestamptz not null,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(email_normalized)
);
create index beta_leads_status_created_idx on beta_leads(status,created_at desc);

create table acquisition_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references beta_leads(id) on delete cascade,
  email_type varchar(24) not null check (email_type in ('welcome','day_1','day_3','beta_access')),
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  status varchar(16) not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lead_id,email_type)
);
create unique index acquisition_email_deliveries_provider_message_unique on acquisition_email_deliveries(provider_message_id) where provider_message_id is not null;
create index acquisition_email_deliveries_due_idx on acquisition_email_deliveries(status,scheduled_at) where status in ('pending','failed');

create table acquisition_email_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references acquisition_email_deliveries(id) on delete set null,
  provider_event_id text not null,
  event_type varchar(96) not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider_event_id)
);
create index acquisition_email_events_delivery_idx on acquisition_email_events(delivery_id,created_at desc);

commit;
