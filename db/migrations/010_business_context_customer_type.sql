-- Distinguishes B2B / B2C / both — the simplified manual onboarding asks
-- this as its one required targeting question, and it also lets the AI
-- analyzer record its own inference from a crawled site for parity.
alter table business_contexts add column customer_type jsonb;
