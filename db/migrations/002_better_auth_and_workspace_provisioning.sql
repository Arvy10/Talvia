-- Better Auth core tables plus Talvia's link to its domain users.
-- Generated structure reviewed against Better Auth 1.7.1 PostgreSQL metadata.
begin;

create table "user" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table session (
  id uuid primary key default gen_random_uuid(),
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid not null references "user"(id) on delete cascade
);
create index session_user_id_idx on session("userId");

create table account (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" uuid not null references "user"(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique (issuer, "accountId")
);
create index account_user_id_idx on account("userId");

create table verification (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index verification_identifier_idx on verification(identifier);

alter table users add column auth_user_id uuid unique references "user"(id) on delete restrict;

commit;
