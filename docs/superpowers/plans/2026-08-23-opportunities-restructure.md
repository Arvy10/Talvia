# Opportunities Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Talvia's compact sandbox sales pipeline with persistent opportunities, accessible stage changes, a contextual drawer, and identifier-only relations to contacts, conversations, and campaigns.

**Architecture:** Extend the shared sandbox Opportunity and activity models, keep all persistence in the existing provider/reducer, and isolate opportunity business rules in `opportunity-model.ts`. Render one client feature composed from focused local components while preserving the existing Talvia design system.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS, Vitest, Testing Library, existing sandbox reducer/localStorage.

## Global Constraints

- Do not add external APIs or AI scoring.
- The accessible stage selector is the source of truth; drag-and-drop is only an enhancement.
- Keep Won visible in V1 and Lost available through the state filter.
- Store only `contactId`, `conversationId`, and `campaignId` relations.
- Reuse the global activity layer and persist structured next-action fields.
- Do not redesign Inbox, Contacts, Campaigns, Automations, Settings, or the global design system.

---

### Task 1: Opportunity domain and persistence

**Files:**
- Modify: `app/app/state/types.ts`
- Modify: `app/app/state/reducer.ts`
- Modify: `app/app/state/storage.ts`
- Create: `app/app/opportunities/opportunity-model.ts`
- Test: `app/app/opportunities/opportunity-model.test.ts`
- Test: `app/app/state/reducer.test.ts`

**Interfaces:**
- Produces: enriched `Opportunity`, opportunity-scoped `SandboxActivity`, `UPDATE_OPPORTUNITY`, `getOpportunityLastActivity`, `isOpportunityStale`, and formatting/filter helpers.

- [ ] Write tests proving stage updates, structured next actions, identifier relations, won/lost closure data, and stale-date calculation.
- [ ] Run `npx vitest run app/app/opportunities/opportunity-model.test.ts app/app/state/reducer.test.ts` and confirm the new assertions fail.
- [ ] Add optional opportunity fields and shared activity references while preserving old stored records.
- [ ] Add reducer update behavior and storage validation for every new optional field.
- [ ] Implement pure opportunity helpers without UI dependencies.
- [ ] Re-run the targeted tests and confirm they pass.

### Task 2: Pipeline, filters, list, and creation flow

**Files:**
- Modify: `app/app/opportunities/OpportunitiesClient.tsx`
- Create: `app/app/opportunities/OpportunityForm.tsx`
- Create: `app/app/opportunities/OpportunityPipeline.tsx`
- Test: `app/app/opportunities/OpportunitiesClient.test.tsx`

**Interfaces:**
- Consumes: the Task 1 model and sandbox actions.
- Produces: searchable/filterable pipeline and list, persistent creation, accessible stage selection, optional native drag enhancement, and duplicate-contact warning.

- [ ] Write interaction tests for creation, multiple opportunities per contact, open/won/lost filtering, pipeline/list switching, and accessible stage changes.
- [ ] Run the new test file and confirm failures against the current minimal UI.
- [ ] Implement the compact toolbar, five visible columns, lost filter, responsive mobile stage selector, and dense list.
- [ ] Implement the modal with required existing contact, optional value/currency, next action/date, notes, and identifier-only prefills.
- [ ] Add native drag events only as a thin wrapper around the same stage-update function used by the selector.
- [ ] Re-run the interaction tests and confirm they pass.

### Task 3: Opportunity drawer and related records

**Files:**
- Create: `app/app/opportunities/OpportunityDrawer.tsx`
- Modify: `app/app/opportunities/OpportunitiesClient.tsx`
- Test: `app/app/opportunities/OpportunitiesClient.test.tsx`

**Interfaces:**
- Consumes: selected opportunity plus contacts, conversations, messages, campaigns, and shared activities from the provider.
- Produces: 780px contextual drawer, mobile full-screen detail, note editing, next-action completion, message routing, and won/lost confirmations.

- [ ] Add tests for drawer opening, contact and source resolution, note persistence, action completion activity, Inbox navigation, won confirmation, and lost reason retention.
- [ ] Run the drawer tests and confirm they fail before implementation.
- [ ] Build the drawer sections using resolved references rather than copied records.
- [ ] Record every real opportunity event in the shared activity list with `opportunityId`.
- [ ] Implement stage, won, and lost dialogs with optional closure fields.
- [ ] Re-run the drawer tests and confirm they pass.

### Task 4: Minimal cross-module prefills

**Files:**
- Modify: `app/app/inbox/InboxClient.tsx`
- Modify: `app/app/contacts/ContactsClient.tsx`
- Modify: `app/app/opportunities/OpportunitiesClient.tsx`
- Test: `app/app/inbox/inbox-model.test.ts`
- Test: `app/app/contacts/ContactsClient.test.tsx`

**Interfaces:**
- Produces: navigation to `/app/opportunities?contactId=...&conversationId=...&campaignId=...` using identifiers only; the opportunity form resolves those identifiers from sandbox state.

- [ ] Add tests that ensure prefill navigation contains only identifiers and Contacts still renders multiple linked opportunities.
- [ ] Run the affected tests and confirm the new integration assertions fail.
- [ ] Replace direct minimal opportunity creation in Inbox/Contacts with the prefilled creation route where those actions exist.
- [ ] Resolve and validate query identifiers inside Opportunities; ignore unknown identifiers safely.
- [ ] Re-run the affected tests and confirm they pass.

### Task 5: Talvia styling, responsive behavior, and final verification

**Files:**
- Modify: `app/app/v2.css`
- Modify: `docs/superpowers/plans/2026-08-23-opportunities-restructure.md`

**Interfaces:**
- Produces: dense Talvia Kanban, controlled tablet scrolling, mobile stage list, 780px drawer, keyboard focus, and reduced-motion support.

- [ ] Add scoped opportunity styles without changing global tokens.
- [ ] Run targeted ESLint on all modified source files.
- [ ] Run `npm test` and require all tests to pass.
- [ ] Run `npm run build` and require the production build to pass.
- [ ] Check desktop, tablet, and mobile layouts in the local browser, including open and collapsed sidebar widths.
- [ ] Commit the implementation and restart the local production server on port 3000.

