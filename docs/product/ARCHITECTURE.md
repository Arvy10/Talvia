# Talvia Product Architecture

This document describes domain boundaries and source-of-truth rules.

It is not a low-level code map. It exists to keep product and engineering architecture coherent.

---

# 1. Domain overview

Conceptual flow:

```text
Prospecting / Approach
        ↓
     Campaigns
        ↓
   Conversation
        ↓
      Inbox
        ↓
Contact + Identity
        ↓
 Commercial Context
        ↓
Follow-up / Qualification
        ↓
   Opportunities
        ↓
    Conversion
```

Cross-cutting layers:

```text
Business Context
        ↓
contextualizes multiple modules

Automations
        ↓
reacts to business events

AI Assistance
        ↓
supports understanding and execution

Connections / Providers
        ↓
connect external communication systems
```

---

# 2. Source-of-truth boundaries

## Contacts

Owns:

- identity;
- company association;
- known roles;
- channel identities;
- durable relationship context.

One human should not become separate Talvia Contacts solely because they use multiple channels.

## Contact Identities

Owns channel-specific identity references.

Examples:

- LinkedIn profile/provider identifier;
- WhatsApp identity;
- email address;
- future communication identifiers.

## Conversations

Owns durable conversation grouping in Talvia.

Provider-specific conversation IDs may be mapped to Talvia conversations.

Provider objects must not replace Talvia conversation entities.

## Messages

Owns normalized message records needed by Talvia.

Provider payloads may be retained selectively for debugging or compatibility, but Talvia should expose stable internal message concepts.

## Inbox

Owns the product experience for active conversation handling.

Once a real conversation exists, Inbox becomes the user's conversational source of truth.

## Campaigns

Owns:

- campaign definition;
- ordered steps;
- participants;
- participant state;
- timing;
- stop/continue logic;
- planned outreach.

## Automations

Owns:

- event-triggered business reactions;
- conditions;
- actions.

Automations should not track linear campaign sequence progress.

## Opportunities

Owns:

- qualified commercial potential;
- pipeline stage;
- expected value if applicable;
- sales progression.

Do not create Opportunities automatically from every message reply.

## Activities

Owns important commercial actions/events.

Examples:

- invitation sent;
- reply received;
- follow-up scheduled;
- opportunity stage changed;
- automation executed.

## Business Context

Owns knowledge about the Talvia user's company.

Examples:

- company;
- sector;
- offers;
- target audience;
- geography;
- positioning;
- pain points;
- sales angles.

It is workspace-scoped.

Human edits have priority over automatic re-analysis.

## Connections

Owns the relationship between a Talvia workspace and external providers/accounts.

---

# 3. Provider architecture

Preferred pattern:

```text
External Channel
      ↓
Provider / Integration
      ↓
Talvia Provider Adapter
      ↓
Normalized Talvia entities
```

Example:

```text
LinkedIn
   ↓
Unipile
   ↓
Unipile Adapter
   ↓
Connections
Conversations
Messages
Contacts
Contact Identities
Activities
```

Do not build:

```text
Talvia UI
   ↓
direct Unipile object usage everywhere
```

Unipile must remain replaceable.

---

# 4. Workspace isolation

All user-owned business data must remain workspace-scoped.

New routes and services should reuse the existing workspace-context pattern.

Never trust client-provided workspace identifiers without server-side membership validation.

---

# 5. Business Context provenance

Supported conceptual provenance:

- `fact`
- `inference`
- `suggestion`
- `user_provided`

Rules:

- AI must not claim `user_provided`.
- user edits must be preserved.
- automatic re-analysis must not silently overwrite human edits.
- source URLs should be retained when useful.

---

# 6. Campaign response behavior

For controlled outbound sequences:

1. participant enters campaign;
2. campaign executes eligible steps;
3. provider actions are idempotent;
4. server re-checks eligibility before future sends;
5. if a reply is detected:
   - stop the participant sequence immediately;
   - record activity;
   - conversation moves into Inbox as source of truth;
   - do not automatically create Opportunity without qualification.

---

# 6b. Outbound reconciliation

A channel whose provider only assigns a thread identifier once a message
exists (email today) must not invent one. The rule:

1. call the provider first, outside any transaction;
2. persist only what the provider confirmed, keyed on a real identifier it
   returned, marked as provisional;
3. reconcile onto the canonical thread when the provider's own event
   supplies it, re-keying the existing row rather than inserting a second;
4. if no identifier comes back at all, create nothing and report the send as
   done — never as failed, which would re-send to a real person.

The provisional state is represented by a NULL thread key, never by parking a
message identifier in the thread column: a unique constraint on that column
defines thread identity, and a value that merely looks like one collides with
nothing when the real thread finally arrives. Reconciliation keys on an
identifier every arrival path carries, so it does not matter which of them
reaches Talvia first.

A provider action that succeeded must never be reported as a failure, and a
local mirror that is incomplete must never be reported as complete.

---

# 7. WhatsApp architecture philosophy

WhatsApp campaigns should prioritize:

- existing leads;
- previously engaged contacts;
- form leads;
- former clients;
- follow-ups;
- reactivation.

Avoid architecture optimized around large-scale cold messaging to unknown contacts.

---

# 8. AI architecture

AI should be abstracted behind provider-independent interfaces when feasible.

Examples:

```text
BusinessAnalyzer
     ↓
AIProvider
     ↓
Anthropic / future provider
```

Do not hardcode provider/model assumptions throughout domain logic.

AI output must be server-validated before persistence.

---

# 9. Failure philosophy

External providers can fail.

Talvia should handle:

- disconnected account;
- expired provider session;
- webhook duplication;
- delayed events;
- provider retry;
- duplicate messages;
- rate limits;
- partial synchronization.

Use idempotency and stable mappings.

Never fabricate successful provider actions.

---

# 10. UI architecture principle

Reuse the existing design system before creating new primitives.

Product screens should prioritize:

- low cognitive load;
- clear hierarchy;
- commercial context;
- next action;
- real data.

Avoid dashboards that display decorative metrics without operational value.
