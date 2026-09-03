# Talvia Product Roadmap

This roadmap is intentionally short.

Its purpose is to protect execution focus.

New ideas should not automatically enter NOW.

---

# NOW — V1 Beta

Primary objective:

> Put Talvia in the hands of real users with one complete, reliable commercial loop.

## P0 — Real integration foundation

- Unipile/provider integration foundation
- provider adapter boundaries
- account connection
- synchronization safety
- webhook ingestion
- idempotency

## P1 — LinkedIn real connection

- connect LinkedIn account
- synchronize conversations
- synchronize messages
- send/reply from Talvia
- map provider identities to Talvia Contacts
- detect inbound replies

## P2 — Real Inbox loop

- real conversations
- real message history
- send/receive
- contact association
- channel identity
- useful conversation context

## P3 — Commercial follow-up

- next action / follow-up
- relevant activities
- link conversation ↔ Contact ↔ Opportunity
- qualified Opportunity creation
- no automatic Opportunity on every reply

## P4 — Private beta

- 5–20 real beta users
- observe activation
- observe repeated usage
- identify broken workflows
- interview users
- prioritize based on evidence

---

# NEXT

Only after the first real loop is working and users are testing.

Potential priorities:

- Gmail integration — **moved into active work (2026-09)**: connection, ingestion,
  historical import, Inbox conversations and campaign execution are built on the
  shared domain entities and the single Campaign Engine. First-touch outbound
  (no existing thread) remains deferred — see DECISIONS.md.
- WhatsApp integration
- stronger Inbox context panel
- conversation summarization
- suggested replies
- detected commercial signals
- recommended next action
- Campaign ↔ Inbox response handoff refinement
- simple re-engagement workflows
- onboarding/business-context improvements based on real data

---

# LATER

Not required for initial beta unless evidence changes priorities.

- advanced analytics
- advanced AI agents
- advanced lead scoring
- complex automation builder
- large integration marketplace
- enterprise permissions
- sophisticated billing
- advanced reporting
- deep customization
- complex pipeline generation
- large-scale workflow templating

---

# Explicitly not a launch blocker

Do not delay beta for:

- perfect onboarding;
- perfect Business Context accuracy;
- every communication channel;
- advanced billing;
- enterprise features;
- perfect visual polish;
- exhaustive automation;
- advanced dashboards;
- broad AI functionality.

---

# Roadmap change rule

A new task may replace a NOW priority only if at least one is true:

1. it fixes a blocker preventing real user value;
2. it resolves a severe reliability/security issue;
3. user evidence shows a stronger need;
4. the existing priority is based on a false assumption;
5. the founder intentionally changes product direction after tradeoff review.

Otherwise:

put the idea in NEXT or LATER.
