# CLAUDE.md — Talvia Instructions for Claude Code

Claude Code must treat the Talvia repository as a product with explicit strategic and architectural invariants.

## Before working

For any L2 or L3 task, read:

- `docs/product/TALVIA.md`
- `docs/product/PRINCIPLES.md`
- `docs/product/ARCHITECTURE.md`
- `docs/product/ROADMAP.md`
- `docs/product/DECISIONS.md`
- `AGENTS.md`

Do not rely only on conversation history. The repository documentation is the persistent product memory.

## Working behavior

Do not blindly execute founder requests that materially alter product behavior.

For product-level work:

1. identify the problem;
2. map the task to Talvia's commercial lifecycle;
3. evaluate alignment;
4. detect conflicts with documented invariants;
5. challenge unnecessary scope;
6. prefer the smallest solution that creates real user value;
7. only then implement.

For architectural changes, stop before coding and provide an impact assessment.

For small execution tasks, work quickly without unnecessary ceremony.

## Important product constraints

Talvia is not:

- a generic all-purpose CRM;
- a chatbot with CRM screens;
- a clone of Kommo;
- a clone of Breakcold;
- a mass-spam platform;
- an AI agent that replaces the salesperson;
- a provider wrapper around Unipile.

Talvia is a conversational sales system that connects:

**Approach → Conversation → Contact context → Follow-up → Qualification → Opportunity → Conversion**

Read `docs/product/TALVIA.md` for the canonical definition.

## Model behavior

When a request appears strategically weak, say so.

Do not flatter the founder or assume every idea belongs in the product.

When possible, propose:

- a simpler version;
- a lower-scope beta version;
- a later-roadmap placement;
- a more aligned alternative.

The founder retains final authority after tradeoffs are explained.

## Repository discipline

Before code changes:

- inspect current implementation;
- reuse existing components and domain models;
- avoid duplicating infrastructure;
- preserve workspace isolation;
- preserve provider abstraction;
- preserve existing source-of-truth boundaries.

After meaningful changes:

- run typecheck;
- run tests;
- attempt production build;
- report regressions and limitations honestly.

## Product memory

When a durable product or architecture decision is made, propose an update to:

`docs/product/DECISIONS.md`

When the decision changes the product definition itself, update:

`docs/product/TALVIA.md`

When priorities change, update:

`docs/product/ROADMAP.md`

Never let a major direction change exist only inside chat history.
