# Talvia Product Decision Log

This file records durable product and architectural decisions.

Do not use it as a daily changelog.

Add entries only when the decision should influence future development.

---

## 2026-08 — Talvia product model

**Decision**

Talvia is a conversational sales operating system connecting:

**Approach → Conversation → Contact/context → Follow-up → Qualification → Opportunity → Conversion**

**Reason**

Talvia should not drift into becoming only a shared inbox or generic CRM.

---

## 2026-08 — Inbox source of truth

**Decision**

Once a real conversation begins, Inbox becomes the conversational source of truth.

**Reason**

Commercial relationships should not remain fragmented between campaigns and message providers.

---

## 2026-08 — Reply does not equal Opportunity

**Decision**

A reply does not automatically create an Opportunity.

Opportunity creation requires sufficient commercial signal or qualification.

**Reason**

Replies may be negative, informational, neutral, or unrelated to sales potential.

---

## 2026-08 — Campaigns vs Automations

**Decision**

Campaigns and Automations remain separate systems.

Campaigns owns ordered commercial sequences and participant execution state.

Automations owns event-triggered business reactions.

**Reason**

Combining both would make sequence logic harder to reason about and weaken domain boundaries.

---

## 2026-08 — LinkedIn campaign behavior

**Decision**

LinkedIn Campaigns should execute controlled outreach workflows.

When a participant replies, future sequence steps stop immediately and Inbox becomes the conversational source of truth.

**Reason**

Continuing automated outreach after a real reply damages the relationship and creates spam-like behavior.

---

## 2026-08 — WhatsApp positioning

**Decision**

WhatsApp is primarily a follow-up, re-engagement, existing-lead, former-client, and conversion channel.

Talvia should not be designed around mass cold WhatsApp outreach.

**Reason**

The product philosophy prioritizes relationship quality, relevant follow-up, and controlled sales behavior.

---

## 2026-08 — AI is a layer, not the product

**Decision**

AI supports Talvia across modules but is not Talvia's core positioning.

**Reason**

The defensible product value should come from context, workflow, provider integrations, memory, and execution—not from competing directly on foundation models.

---

## 2026-08 — Business Context

**Decision**

Business Context is a workspace-scoped understanding of the company using Talvia.

It can support Inbox, Campaigns, prospecting, qualification, Automations, reply preparation, and recommendations.

**Reason**

Business Context should become reusable product infrastructure rather than remain an onboarding-only feature.

---

## 2026-08 — Human Business Context edits

**Decision**

User-provided Business Context data takes precedence over automatic re-analysis.

Automatic analysis must not silently overwrite manually edited fields.

**Reason**

Human intent is authoritative and AI inference may be wrong.

---

## 2026-08 — Provider abstraction

**Decision**

External providers such as Unipile are infrastructure, not Talvia's domain model.

Provider-specific objects should be normalized through adapters into Talvia-owned entities.

**Reason**

Avoid vendor lock-in and prevent provider details from spreading throughout the application.

---

## 2026-08 — Onboarding philosophy

**Decision**

Onboarding asks the minimum needed to start.

Advanced Business Context remains available later in settings.

**Reason**

The user should not have to configure a CRM or marketing strategy before seeing value.

---

## 2026-08 — Beta launch philosophy

**Decision**

Talvia should launch a private beta once one real commercial loop is functional, even if many planned features are incomplete.

**Reason**

Real user feedback is now more valuable than continued speculative polish.

---

## 2026-08 — Initial integration priority

**Decision**

The next major product priority is real provider integration, starting with LinkedIn before expanding broadly.

**Reason**

Real conversations and real commercial workflows create more user value than further polishing secondary configuration surfaces.
