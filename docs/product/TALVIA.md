# Talvia — Canonical Product Definition

This document is the primary product source of truth for Talvia.

All product, engineering, design, AI, integration, and architecture decisions should remain compatible with this definition unless the founder intentionally changes the product direction.

---

# 1. What Talvia is

Talvia is a **conversational sales operating system** that connects prospecting, conversations, follow-up, qualification, and opportunities in one coherent commercial workflow.

Talvia is designed to help founders, independents, agencies, salespeople, and small commercial teams manage active prospects and relationships without constantly switching between disconnected channels and tools.

Talvia's commercial lifecycle is:

**Approach → Conversation → Contact + Context → Follow-up / Re-engagement → Qualification → Opportunity → Conversion**

Talvia should progressively reduce the operational work required to keep commercial relationships under control.

---

# 2. Core problem

Commercial activity is fragmented.

A prospect may:

- be discovered on LinkedIn;
- receive an invitation or outreach;
- reply in LinkedIn;
- continue by email;
- ask to move to WhatsApp;
- receive a proposal;
- need a follow-up several days later;
- become a real sales opportunity.

Without a coherent system, the salesperson must remember:

- who the prospect is;
- where the conversation happened;
- what was said;
- what the next action is;
- whether a follow-up is due;
- whether the prospect is qualified;
- whether an opportunity exists.

Talvia exists to prevent commercial relationships from becoming fragmented across tools, memory, spreadsheets, inboxes, and manual notes.

---

# 3. Product promise

Talvia should answer one operational question better and better over time:

> **What deserves my commercial attention now?**

Talvia should help the user:

- approach;
- communicate;
- remember;
- organize;
- follow up;
- qualify;
- prioritize;
- prepare;
- convert.

The product should not require the user to become a CRM expert.

---

# 4. Talvia is relationship-first

The human remains responsible for the relationship.

Talvia can:

- organize;
- summarize;
- remember;
- suggest;
- prepare;
- remind;
- classify;
- detect signals;
- recommend next actions;
- automate repetitive operational work.

Talvia should not blindly automate human relationships.

Canonical principle:

> **Automatisez le travail. Pas la relation.**

---

# 5. Main modules

## Inbox

Inbox is the conversational source of truth once a real conversation exists.

It should allow the user to understand:

- who is speaking;
- on which channel;
- what was said;
- the commercial context;
- the next relevant action.

Inbox is not merely a message archive.

It should progressively become an actionable commercial workspace.

## Contacts

Contacts is the source of truth for identity and relationship context.

A contact may have multiple channel identities:

- LinkedIn;
- WhatsApp;
- email;
- future channels.

Do not duplicate one human into unrelated contact records merely because they use multiple channels.

## Campaigns

Campaigns orchestrate controlled commercial approach sequences.

Examples:

- LinkedIn invitation;
- wait;
- message;
- wait;
- follow-up;
- stop on reply.

Campaigns owns sequence state, timing, participant progress, and planned outreach behavior.

## Automations

Automations reacts to business events.

Examples:

- when a reply arrives, create an activity;
- when an opportunity changes stage, create a follow-up task;
- when a prospect becomes qualified, notify the team.

Automations must not replace the campaign sequence engine.

## Opportunities

Opportunities represents qualified commercial potential.

A message reply alone does not automatically create an Opportunity.

A reply may be:

- positive;
- neutral;
- negative;
- informational;
- support-related;
- unrelated.

An Opportunity should exist when there is sufficient commercial signal or explicit qualification.

## Business Context

Business Context describes the company using Talvia.

It may contain:

- company identity;
- activity;
- offers;
- target customers;
- positioning;
- geographies;
- sales context;
- inferred pain points;
- suggested sales angles.

Business Context should eventually support:

- onboarding;
- Inbox;
- reply suggestions;
- qualification;
- Campaigns;
- prospecting;
- Automations;
- commercial recommendations.

Business Context is not merely an onboarding artifact.

## Connections

Connections represents external provider/channel connections.

External providers may include:

- Unipile;
- Google;
- LinkedIn integration providers;
- WhatsApp providers;
- future providers.

Providers are infrastructure.

They must not become Talvia's product-domain source of truth.

---

# 6. Channel philosophy

## LinkedIn

LinkedIn is an important prospecting and controlled outreach channel.

Talvia may support:

- connection requests;
- outreach sequences;
- messaging;
- replies;
- commercial follow-up.

When a real reply/conversation begins, Inbox becomes the conversational source of truth.

## WhatsApp

WhatsApp is primarily intended for:

- follow-up;
- re-engagement;
- continuation of an existing conversation;
- warm lead communication;
- former clients;
- conversion.

Talvia should not be positioned as a mass cold WhatsApp spam engine.

## Gmail / Email

Email supports:

- conversation;
- follow-up;
- proposals;
- re-engagement;
- controlled outbound campaigns;
- sales continuity.

---

# 7. AI philosophy

AI is not the product.

AI is a cross-product assistance layer.

AI may:

- summarize;
- classify;
- infer;
- suggest;
- prepare replies;
- identify signals;
- recommend follow-up;
- help qualification;
- enrich Business Context.

The product should remain coherent even if the user never opens a chatbot.

Avoid building Talvia as "ChatGPT for sales."

---

# 8. Target market

Initial users may include:

- founders;
- freelancers;
- independent salespeople;
- agencies;
- service businesses;
- small sales teams.

Talvia is not strategically limited to French-speaking markets.

The product should be architected for international use.

African and francophone markets may be important early markets, especially where commercial workflows are highly conversational and heavily use WhatsApp, social platforms, and informal/manual follow-up.

However:

**locale is not the product definition.**

---

# 9. What Talvia is not

Talvia is not:

- a generic enterprise CRM;
- a feature clone of HubSpot;
- a feature clone of Kommo;
- a feature clone of Breakcold;
- a website builder;
- an ERP;
- an accounting tool;
- a social network;
- an AI chatbot with CRM screens;
- a cold-spam automation engine;
- a provider UI for Unipile;
- a product whose main value is "having more features."

---

# 10. Product differentiation direction

Talvia should aim to combine:

- strong conversation-to-sales continuity;
- low configuration burden;
- proactive commercial awareness;
- simple workflows;
- contextual assistance;
- multi-channel continuity;
- human-centered selling.

The intended direction is:

> **A sales system that requires less CRM administration while keeping the user in control of the relationship.**

---

# 11. Product success criteria

Talvia is creating value when users:

- stop losing track of prospects;
- follow up more consistently;
- understand conversations faster;
- spend less time updating CRM data;
- know what deserves attention;
- move more qualified prospects toward conversion.

Feature count is not a success metric.

---

# 12. Beta principle

The V1 should launch when Talvia provides one complete, reliable commercial loop.

A credible initial loop is:

1. create account/workspace;
2. configure Business Context quickly;
3. connect at least one real channel;
4. synchronize real conversations;
5. read and send messages;
6. correctly associate Contacts;
7. track commercial follow-up;
8. turn qualified conversations into Opportunities.

Do not wait for every planned feature before testing with real users.
