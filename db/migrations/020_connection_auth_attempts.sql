-- Hosted-auth correlation, without ever putting the global
-- UNIPILE_WEBHOOK_SECRET (or the raw workspace_id) in a URL Unipile calls
-- back. One row per POST /api/connections/[channel]/connect — a
-- single-use, short-lived, opaque token minted at that moment carries the
-- correlation instead; only its hash is stored here, never the raw token.
-- See app/lib/providers/unipile-adapter.ts's createConnectionAuthAttempt /
-- resolveConnectionAuthAttempt.
--
-- external_account_id starts null and is bound atomically to whichever
-- account_id first successfully resolves this token (a single UPDATE whose
-- WHERE clause is the compare-and-set: `external_account_id is null or
-- external_account_id=$accountId` — see resolveConnectionAuthAttempt). A
-- redelivery of the same account_id then still matches and succeeds
-- (idempotent); a different account_id never matches once bound, and is
-- rejected — Postgres's row-level locking on that UPDATE is what makes two
-- concurrent callbacks for different account_ids race-safe: the second
-- transaction blocks on the row lock until the first commits, then
-- re-evaluates its own WHERE clause against the now-committed value.
--
-- unique(token_hash) is a real UNIQUE CONSTRAINT (not just an index) —
-- Postgres backs it with a unique b-tree index automatically.
--
-- Cleanup: deliberately no scheduled job for expired/consumed rows — one
-- row per connection attempt is a tiny, slow-growing table (a handful of
-- rows per workspace, ever), and an expired row is simply never matched by
-- resolveConnectionAuthAttempt (checked against expires_at at read time).
-- A manual `delete from connection_auth_attempts where expires_at < now() -
-- interval '7 days'` is safe to run any time this table's size becomes
-- worth reclaiming — not needed for correctness today.
begin;

create table connection_auth_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_type varchar(24) not null check (channel_type in ('linkedin','whatsapp','email','instagram','other')),
  token_hash text not null,
  external_account_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(token_hash)
);
create index connection_auth_attempts_expiry_idx on connection_auth_attempts(expires_at);

commit;
