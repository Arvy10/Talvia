# Automations Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build simple, persistent sandbox automation rules executed by one common local engine.

**Architecture:** A pure automation engine translates sandbox events into reducer mutations and global activity entries. The Automations UI creates and manages rules, while Inbox, Campaigns, Contacts and Opportunities publish minimal identifier-based events to that engine.

**Tech Stack:** Next.js, React, TypeScript, existing reducer/localStorage, Vitest.

## Global Constraints

- Never call an external API or send a real message.
- The engine is the sole source of truth for real events and sandbox tests.
- `replyMode: auto` is labelled simulation-only and requires explicit confirmation.
- Do not redesign existing product modules.

---

### Task 1: Automation types, validation and engine

**Files:**
- Modify: `app/app/state/types.ts`, `app/app/state/reducer.ts`, `app/app/state/storage.ts`
- Create: `app/app/automations/automation-engine.ts`
- Test: `app/app/automations/automation-engine.test.ts`

**Interfaces:** Produces `AutomationEvent`, `runAutomations(state, event)`, typed execution outcomes and reducer actions for updates/deletes.

- [ ] Write tests for inactive skipping, campaign stopping, proposal next action, inbox priority and test execution history.
- [ ] Run `npx vitest run app/app/automations/automation-engine.test.ts` and confirm the new assertions fail.
- [ ] Add the model, validation and pure engine which returns state mutations plus global activities.
- [ ] Run the engine tests and confirm they pass.

### Task 2: Automation management UI

**Files:**
- Modify: `app/app/automations/AutomationsClient.tsx`, `app/app/automations/templates.ts`, `app/app/v2.css`
- Test: `app/app/automations/templates.test.ts`

**Interfaces:** Consumes Task 1 engine and automation model. Produces tabs, dense list, template prefill, rule editor, edit/duplicate/delete/toggle, detail and test action.

- [ ] Write interaction tests for template prefill, persistence, active toggle, duplicate inactive, delete confirmation and test action.
- [ ] Run the UI tests and confirm failures against the existing module.
- [ ] Implement the readable `Quand → Alors` cards and vertical builder with optional condition and future response settings.
- [ ] Make « Exécuter un test » invoke Task 1’s engine with a controlled event.
- [ ] Run the UI tests and confirm they pass.

### Task 3: Minimal event publishers and validation

**Files:**
- Modify only where events already occur: `app/app/inbox/InboxClient.tsx`, `app/app/opportunities/OpportunitiesClient.tsx`, `app/app/contacts/ContactsClient.tsx`, `app/app/state/reducer.ts`
- Test: `app/app/state/reducer.test.ts`, `app/app/automations/automation-engine.test.ts`

**Interfaces:** Each publisher sends only IDs/channel/stage to `runAutomations`; reducer applies returned mutations and activities.

- [ ] Write regression tests proving event publisher inputs do not contain copied contacts or messages.
- [ ] Implement calls after existing sandbox mutations, without changing their UI workflows.
- [ ] Run `npm test`, `npm run build`, inspect desktop/mobile, commit and restart the server.
