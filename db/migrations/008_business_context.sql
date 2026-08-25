create table business_contexts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  is_active boolean not null default true,
  status varchar(24) not null default 'ready' check (status in ('pending', 'analyzing', 'ready', 'error', 'insufficient_content')),
  error_reason text,
  website text,
  company_name text,
  industry jsonb,
  business_description text,
  value_proposition jsonb,
  services jsonb not null default '[]'::jsonb,
  products jsonb not null default '[]'::jsonb,
  target_customers jsonb not null default '[]'::jsonb,
  target_industries jsonb not null default '[]'::jsonb,
  target_company_sizes jsonb not null default '[]'::jsonb,
  target_roles jsonb not null default '[]'::jsonb,
  geographies jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  pain_points jsonb not null default '[]'::jsonb,
  sales_angles jsonb not null default '[]'::jsonb,
  primary_language text,
  source varchar(24) not null default 'website_analysis' check (source in ('website_analysis', 'manual')),
  analysis_version text,
  source_pages jsonb not null default '[]'::jsonb,
  manually_edited_fields jsonb not null default '[]'::jsonb,
  ai_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active Business Context per workspace, enforced at the DB level
-- so an application bug can never silently create two active contexts.
create unique index business_contexts_one_active_per_workspace
  on business_contexts (workspace_id)
  where is_active;

create index business_contexts_workspace_idx on business_contexts (workspace_id, created_at desc);

create table business_context_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  business_context_id uuid references business_contexts(id) on delete set null,
  website text not null,
  status varchar(24) not null check (status in ('succeeded', 'failed', 'insufficient_content')),
  pages_fetched integer not null default 0,
  content_chars integer not null default 0,
  duration_ms integer not null default 0,
  ai_model text,
  input_tokens integer,
  output_tokens integer,
  error_reason text,
  created_at timestamptz not null default now()
);

create index business_context_analysis_runs_workspace_idx
  on business_context_analysis_runs (workspace_id, created_at desc);
