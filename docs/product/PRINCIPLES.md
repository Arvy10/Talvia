# Talvia Product Principles

These principles are decision filters.

They exist to prevent Talvia from becoming a collection of unrelated features.

---

# 1. User outcome before feature count

Do not ask:

> What feature can we add?

Ask:

> What user problem is preventing the commercial loop from working better?

A smaller product that completes a real workflow is more valuable than a larger product made of disconnected modules.

---

# 2. Complexity belongs in the system, not in the user's head

Talvia may contain sophisticated backend logic.

The UI should remain simple.

Preferred pattern:

**complex backend → simple user decision**

Avoid making users configure:

- CRM architecture;
- complex scoring systems;
- dozens of workflow conditions;
- detailed segmentation;
- advanced sales taxonomy;

unless there is proven demand.

---

# 3. Talvia should reduce administration

Where possible:

- infer;
- prefill;
- recommend;
- reuse known context;
- learn from prior user actions;
- preserve history.

Do not ask the user for information Talvia can reasonably derive.

---

# 4. Conversation is not the same as opportunity

A conversation can exist without commercial intent.

Do not automatically create an Opportunity because someone replied.

Qualification should reflect real commercial signal.

---

# 5. Human input has authority over AI inference

User-provided or user-corrected Business Context must not be silently overwritten by re-analysis.

AI should distinguish:

- facts observed from sources;
- inference;
- suggestions;
- user-provided data.

---

# 6. Campaigns and Automations are different systems

Campaigns:

- planned sequence;
- ordered steps;
- timing;
- participant progress;
- stop conditions.

Automations:

- event → business reaction.

Do not merge these models because they happen to trigger actions.

---

# 7. Provider independence

External providers are replaceable infrastructure.

Talvia owns its domain model.

Do not spread provider-specific objects throughout the product.

Use adapters and stable internal entities.

---

# 8. Build for real usage before polish

For V1, prioritize:

- real connections;
- real data;
- real conversations;
- send/receive;
- contact synchronization;
- commercial follow-up;
- beta feedback.

Do not block beta on:

- perfect analytics;
- complete billing;
- advanced AI;
- every integration;
- visual perfection;
- edge-case configuration.

---

# 9. Every significant feature must pass five tests

Before implementation:

## Problem

What user problem does it solve?

## Lifecycle

Where does it belong?

- Approach
- Conversation
- Contact/context
- Follow-up
- Qualification
- Opportunity
- Conversion

## Necessity

Is it needed for NOW, NEXT, or LATER?

## Simplicity

Can the outcome be achieved with less configuration or fewer interactions?

## Coherence

Does it strengthen Talvia's core or make Talvia more generic?

---

# 10. Progressive disclosure

Do not expose every option immediately.

Show complexity when it becomes relevant.

Examples:

- onboarding asks the minimum;
- advanced Business Context stays in settings;
- B2B-only fields do not appear for B2C users;
- advanced automation controls remain hidden until required.

---

# 11. Proactive, not intrusive

Talvia should progressively identify:

- stale conversations;
- missed follow-ups;
- unanswered proposals;
- qualified signals;
- conversations requiring attention.

But it should avoid becoming noisy.

A recommendation should be:

- relevant;
- explainable;
- actionable.

---

# 12. AI must earn its place

Do not add AI because AI is marketable.

Use AI when it materially improves:

- understanding;
- speed;
- prioritization;
- preparation;
- classification;
- context.

Prefer deterministic rules when rules are simpler and more reliable.

---

# 13. New ideas go to backlog by default

A new idea does not automatically change current priorities.

Classify it:

- NOW
- NEXT
- LATER
- REJECTED

Only intentionally change NOW when the new work is more important than the current launch path.

---

# 14. Value perception matters

A feature may be technically correct but commercially weak.

For major flows ask:

> Does the user feel a meaningful benefit within the first session?

The initial Talvia experience should quickly demonstrate:

- reduced effort;
- better context;
- better visibility;
- useful next actions.

---

# 15. Build for internationalization

Do not hardcode product strategy around one locale.

Avoid assuming:

- French only;
- Congo only;
- one timezone;
- one country format;
- one commercial culture.

Localized defaults are allowed.
Architectural lock-in is not.
