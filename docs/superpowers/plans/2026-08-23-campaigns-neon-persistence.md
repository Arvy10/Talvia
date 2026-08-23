# Campagnes Neon Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sandbox Campaign source of truth with tenant-isolated PostgreSQL persistence while preserving the existing Talvia campaign UX.

**Architecture:** Reuse the existing `database`, `WorkspaceContext`, route handler, and activity patterns used by Contacts and Opportunities. The initial schema already owns `campaigns`, `campaign_steps`, and `campaign_participants`; migration 004 adds only the indexes/integrity fields missing for the live module. The client fetches Contacts and Campaign APIs and retains only transient wizard UI state locally.

**Tech Stack:** Next.js App Router, TypeScript, PostgreSQL/Neon (`pg`), Better Auth, Vitest, React.

## Global Constraints

- PostgreSQL/Neon is the sole source of truth for Campaigns.
- Do not migrate Inbox or Automatisations in this pass.
- Do not send messages, call providers, or imply external delivery.
- Every resource lookup scopes by the resolved current workspace; client-provided workspace IDs are ignored.
- Contacts are referenced by ID only; archived contacts cannot be newly added.
- Preserve the existing campaign UI hierarchy and responsive behaviour.
- Never commit `.env.local`, credentials, or generated `tsconfig.tsbuildinfo`.

---

### Task 1: Schema hardening and domain contract

**Files:**
- Create: `db/migrations/004_campaigns_persistence.sql`
- Create: `app/lib/campaigns.ts`

**Interfaces:**
- Produces `CampaignInput`, `CampaignStepInput`, `CampaignRecord`, `CampaignParticipantRecord` and workspace-scoped data functions.
- Consumes `WorkspaceContext`, `database`, `getContact`.

- [ ] Write SQL that adds `campaigns(workspace_id,status,created_at)` and participant/contact indexes without duplicating existing tables.
- [ ] Add a versioned migration check for the pre-existing `opportunities.campaign_id` FK and leave it intact.
- [ ] Define channel, objective, status, step and participant unions that match the existing database checks.
- [ ] Implement transactional creation of campaign, ordered steps and participants.
- [ ] Record `activities` events using `campaign.*`; do not create a parallel history table.
- [ ] Commit with `feat: persist campaigns in Neon`.

### Task 2: Secure server API

**Files:**
- Create: `app/api/campaigns/route.ts`
- Create: `app/api/campaigns/[campaignId]/route.ts`
- Create: `app/api/campaigns/[campaignId]/participants/route.ts`
- Create: `app/api/campaigns/[campaignId]/participants/[participantId]/route.ts`
- Create: `app/api/campaigns/[campaignId]/steps/route.ts`
- Create: `app/api/campaigns/[campaignId]/steps/[stepId]/route.ts`

**Interfaces:**
- Consumes `getCurrentWorkspace()` and the Task 1 functions.
- Produces JSON API responses: `201` create, `200` mutation, `404` for out-of-workspace campaign/step/participant, `400` for invalid/foreign contacts.

- [ ] Add list/create handlers with safe French error responses.
- [ ] Add detail/update/lifecycle handlers (`activate`, `pause`, `resume`, `complete`, `archive`).
- [ ] Add participant add/remove/stop handlers with campaign and contact workspace validation.
- [ ] Add step create/update/delete/reorder handlers, with deterministic positions and no unsafe deletion of a referenced current step.
- [ ] Commit with `feat: add campaign API`.

### Task 3: Migrate the existing Campaigns client

**Files:**
- Modify: `app/app/campaigns/CampaignsClient.tsx`
- Modify: `app/app/campaigns/page.tsx` only if server props/loading boundary is required

**Interfaces:**
- Consumes `/api/contacts` and `/api/campaigns` responses.
- Produces API writes for wizard creation, lifecycle actions, and participant stop.

- [ ] Replace `state.campaigns` reads and `CREATE_CAMPAIGN`/`UPDATE_CAMPAIGN`/`DELETE_CAMPAIGN` dispatches with fetch plus refresh state.
- [ ] Retain the existing wizard, filters, channels, sequence UI and responsive classes.
- [ ] Populate audience from non-archived database contacts and visibly mark incompatible channels.
- [ ] Keep the simulation note; remove sandbox message creation and simulated Inbox reply behaviour.
- [ ] Wire campaign lifecycle controls to the API and preserve participants on pause/resume.
- [ ] Commit with `feat: connect campaigns UI to Neon`.

### Task 4: Reproducible validation

**Files:**
- Create: `scripts/validate-campaigns.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces `validation/campaigns-validation.json`, ignored by Git.
- Adds `npm run test:campaigns:validation`.

- [ ] Create two Better Auth users/workspaces and each user’s compatible contact.
- [ ] Verify creation with ordered Message → Wait → Follow-up, participant persistence and duplicate prevention.
- [ ] Verify read/update/lifecycle/participant/step cross-workspace routes return `404`.
- [ ] Verify foreign-contact injection returns `400` or `404` and creates no relation.
- [ ] Verify activate/pause/resume/stop/complete/archive and logout/login persistence.
- [ ] Commit with `test: add campaign workspace validation`.

### Task 5: Quality and handoff

**Files:**
- Modify only files required to resolve Campaign regressions found by checks.

- [ ] Run `npm run test:campaigns:validation` and inspect its JSON report.
- [ ] Run `npm run lint`.
- [ ] Run `npx tsc --noEmit`; distinguish the known Contacts/Sandbox test errors from new Campaign errors.
- [ ] Run `npm run build`; report the exact stage reached if terminal output is interrupted.
- [ ] Push the final commit and stop before Inbox.

## Self-review

- Schema work reuses the initial tables rather than creating a second campaign model.
- All required cross-workspace, lifecycle, participant, step, channel identity and relogin scenarios are assigned to Tasks 2–4.
- No provider, Inbox, job queue, or real sending work is in scope.
