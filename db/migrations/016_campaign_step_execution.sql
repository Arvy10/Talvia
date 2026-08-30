-- Campaign execution engine, phase 1B: campaign_steps becomes the real
-- source of truth for what happens next, instead of the invite step being
-- the only one with atomic-claim/idempotence support. Two generic columns
-- replace step-specific ones for the claim mechanism itself:
--   - step_claimed_at: in-flight claim marker for whatever the participant's
--     CURRENT step is (generalizes invite_claimed_at's role across step
--     types — invite_claimed_at itself is left in place, unused by new code,
--     since dropping it isn't required for this work).
--   - message_sent_at: the message-step equivalent of invite_sent_at, giving
--     the message step the same "claim once, never resend" guarantee the
--     invite step already had.
-- Deliberately NOT adding a due_at/next_action_due_at column here — no WAIT
-- step exists yet to need one, and adding it later is a one-column,
-- additive migration plus one more predicate in the claim query's WHERE
-- clause, not a structural change.
begin;

alter table campaign_participants add column if not exists step_claimed_at timestamptz;
alter table campaign_participants add column if not exists message_sent_at timestamptz;

commit;
