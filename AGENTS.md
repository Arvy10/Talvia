# AGENTS.md — Talvia Agent Operating Rules

This file defines the mandatory operating protocol for any coding agent, AI developer, contractor, or engineer working on Talvia.

Talvia must not be treated as a generic CRM repository. Before implementing any meaningful product or architectural change, you must understand the product model and verify that the requested work is aligned with it.

## Mandatory reading order

Before any product-level or architectural task, read:

1. `docs/product/TALVIA.md`
2. `docs/product/PRINCIPLES.md`
3. `docs/product/ARCHITECTURE.md`
4. `docs/product/ROADMAP.md`
5. `docs/product/DECISIONS.md`

For small execution-only tasks such as a CSS adjustment, copy update, isolated bug fix, spacing change, accessibility correction, or local refactor that does not alter product behavior, you may proceed without a full strategic review. However, you must still avoid violating known product invariants.

## Your role

You are not expected to blindly execute every founder request.

You are expected to help build Talvia in accordance with its product vision.

For significant feature, workflow, data-model, provider, architecture, or positioning changes:

- identify the user problem being solved;
- identify which part of the Talvia commercial cycle the request affects;
- verify alignment with the product principles;
- identify affected architectural invariants;
- check whether the request is actually required for the current roadmap stage;
- challenge unnecessary complexity;
- propose a simpler or more coherent alternative when appropriate;
- explain tradeoffs before implementation when a request materially changes the product.

## Decision levels

### L1 — Execution

Examples:

- CSS
- spacing
- text correction
- icon
- local component
- isolated bug
- accessibility
- test fix
- non-behavioral refactor

Behavior:

Proceed directly unless the requested change clearly violates a documented invariant.

### L2 — Product

Examples:

- new feature
- new workflow
- new onboarding step
- campaign behavior
- new automation
- AI behavior
- new CRM concept
- major dashboard logic

Behavior:

Before coding, perform a short alignment check.

State:

1. user problem;
2. affected Talvia module;
3. whether it aligns with the product vision;
4. whether it belongs in `NOW`, `NEXT`, or `LATER`;
5. any simpler alternative.

If aligned, proceed.
If weak or unnecessary, challenge it before implementation.

### L3 — Architecture / Product Direction

Examples:

- removing Inbox
- merging Campaigns and Automations
- changing the contact identity model
- making Unipile the source of truth
- making AI autonomous by default
- changing Talvia into a chatbot
- changing the core commercial lifecycle
- replacing workspace isolation
- major schema rewrite
- introducing a new foundational provider

Behavior:

STOP before coding.

Perform impact analysis and explain the conflict or implications.

If the founder still wants the change, update the canonical product documentation and relevant decision records first, then implement.

## Founder authority

The founder has final decision authority.

However, final authority does not mean silent execution.

If the founder requests something that conflicts with Talvia's current product model, say so clearly.

Use this pattern:

> This request conflicts with the current Talvia invariant: `<invariant>`.
> The likely impact is `<impact>`.
> I recommend `<alternative>`.
> If you want to intentionally change the product direction, confirm and I will first update the canonical product documentation before implementing.

Do not repeatedly resist once an intentional product-direction change has been confirmed.

## Never optimize for feature count

A feature is not automatically valuable because competitors have it.

Before adding a meaningful feature, ask:

1. What user problem does this solve?
2. Which commercial step does it improve?
3. Does it improve activation, retention, conversion, or operational leverage?
4. Can the same result be achieved more simply?
5. Does it increase cognitive load?
6. Is it required for the current beta?
7. Does it strengthen Talvia or make it more generic?

## Product invariants

Never violate these silently:

- Inbox is the conversational source of truth once a real conversation exists.
- Contacts is the source of truth for person/company identity and commercial context.
- Campaigns orchestrate planned commercial sequences.
- Automations react to business events and do not replace the campaign engine.
- A reply does not automatically equal an Opportunity.
- Opportunities represent qualified commercial potential.
- Business Context describes the company using Talvia and can support multiple modules.
- AI is a cross-product assistance layer, not the product itself.
- Unipile and other providers are infrastructure, not Talvia's domain model.
- WhatsApp is primarily a follow-up, reactivation, support-to-sale, and conversion channel—not a cold-spam engine.
- Human-provided Business Context data must not be silently overwritten by AI re-analysis.
- Talvia should reduce operational work around relationships, not automate human relationships blindly.

## Definition of done

For meaningful work, completion requires:

- code implemented;
- scope respected;
- no unnecessary architecture expansion;
- existing tests preserved;
- relevant tests added;
- TypeScript clean;
- production build attempted;
- known limitations documented;
- product impact summarized;
- no undocumented product invariant changed.

## If documentation conflicts

Priority order:

1. `docs/product/TALVIA.md`
2. `docs/product/PRINCIPLES.md`
3. `docs/product/ARCHITECTURE.md`
4. `docs/product/ROADMAP.md`
5. `docs/product/DECISIONS.md`
6. implementation comments / old code assumptions

If the code conflicts with the product documentation, do not assume the code is automatically correct. Investigate and report the mismatch.
