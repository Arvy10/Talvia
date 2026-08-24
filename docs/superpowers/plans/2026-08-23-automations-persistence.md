# Automations Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Talvia Automatisations and execute V1 rules from shared Neon activities.

**Architecture:** Extend current schema, centralize activity recording and process only committed domain events. The engine is workspace-scoped, idempotent and loop-safe; UI becomes an API consumer without visual redesign.

**Tech Stack:** Next.js route handlers, TypeScript, pg/Neon, Better Auth.

**Spec:** `docs/superpowers/specs/2026-08-23-automations-persistence-design.md`

## Global Constraints

- No external provider, OpenAI, queue, worker or real message sending.
- Preserve existing Automatisations UI and do not start Vue d’ensemble.
- Never commit `.env.local`, validation reports or generated TypeScript output.

### Task 1: Schema and shared activities

**Files:** `db/migrations/006_automations_persistence.sql`, `app/lib/activities.ts`

- [ ] Add status migration, activity source/run metadata, run trigger type and partial unique idempotency index.
- [ ] Add `recordActivity(context, input)` returning the committed activity; make automation-generated events source `automation`.

### Task 2: Automation service and routes

**Files:** `app/lib/automations.ts`, `app/api/automations/**`

- [ ] Implement scoped CRUD, activation, archive, duplicate, run listing and test activity route.
- [ ] Implement `processActivity(activity)` with flat condition evaluation, run creation and failed-run isolation.
- [ ] Use existing Contacts, Opportunities, Campaigns and Inbox services for actions.

### Task 3: Domain event wiring

**Files:** `app/lib/contacts.ts`, `app/lib/opportunities.ts`, `app/lib/campaigns.ts`, `app/lib/inbox.ts`

- [ ] Replace direct activity inserts with common activity recording.
- [ ] Invoke the engine only after successful mutation and swallow engine failures after recording a failed run.

### Task 4: Client migration

**Files:** `app/app/automations/AutomationsClient.tsx`, `app/app/automations/*`

- [ ] Replace sandbox automation reads/writes with API calls.
- [ ] Keep templates, test, history, filters, responsive layout and builder semantics.

### Task 5: Reproducible validation

**Files:** `scripts/validate-automations.mjs`, `package.json`

- [ ] Persist a JSON result after each test scenario.
- [ ] Run validation, lint, typecheck, build, then commit and push only this pass.
