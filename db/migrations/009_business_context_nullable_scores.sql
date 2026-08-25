-- 008 declared these columns not-null, but the application legitimately
-- inserts null for them (manual profile creation, or a failed analysis
-- that has no field data yet) — that NOT NULL constraint was a mistake,
-- causing every such insert to fail with a generic "Erreur serveur."
alter table business_contexts
  alter column target_customers drop not null,
  alter column target_industries drop not null,
  alter column target_company_sizes drop not null,
  alter column target_roles drop not null,
  alter column geographies drop not null,
  alter column pain_points drop not null,
  alter column sales_angles drop not null;
