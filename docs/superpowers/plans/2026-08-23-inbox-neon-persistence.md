# Inbox Neon Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sandbox Inbox source of truth with secure, persistent Neon conversations, participants, messages, drafts and per-user read state.

**Architecture:** Reuse `database`, `WorkspaceContext`, activities and API conventions from Contacts, Opportunities and Campaigns. Migration 005 adapts the pre-existing conversation tables rather than recreating them; `conversation_member_states` carries per-user `last_read_at` so unread can evolve to collaborative workspaces. Drafts use the existing `messages` table with `status='draft'`, excluded from conversation previews and never represented as sent.

**Tech Stack:** Next.js App Router, TypeScript, PostgreSQL/Neon (`pg`), Better Auth, React, Vitest.

## Global Constraints

- Inbox PostgreSQL is the only source of truth for conversations, messages, unread and archive state.
- Do not integrate any provider, webhooks, OpenAI, jobs, or real sending.
- All linked contacts and conversations are checked against the current server-side workspace.
- Provider IDs remain nullable; no fake provider IDs or connections are created.
- Preserve the existing Inbox layout, filters, responsive behaviour and AI button as a draft-only demo.
- Do not migrate Automatisations or silently mirror Neon Inbox data into its sandbox.
- Never commit secrets, validation JSON, or `tsconfig.tsbuildinfo`.

---

### Task 1: Versioned Inbox schema and domain layer

**Files:**
- Create: `db/migrations/005_inbox_persistence.sql`
- Create: `app/lib/inbox.ts`

**Interfaces:**
- Produces `InboxConversationInput`, `InboxMessageInput`, `InboxConversation`, `InboxMessage`.
- Produces workspace-scoped functions: `listConversations`, `getConversation`, `createConversation`, `createMessage`, `saveDraft`, `markRead`, `markUnread`, `archiveConversation`, `reopenConversation`.

- [ ] Add nullable `connections`/provider compatibility fields and archive support to existing `conversations`; preserve historical rows.
- [ ] Extend the existing message status constraint with `draft` and `received`, retaining `pending`, `sent`, `delivered`, `failed`, `read`.
- [ ] Add `conversation_member_states(conversation_id,user_id,last_read_at,updated_at)` with `unique(conversation_id,user_id)`.
- [ ] Add indexes for workspace conversation sorting/filtering, participants by contact, and message history.
- [ ] Implement one transaction for conversation + real Contact participants + optional initial message/draft; invalid contact rolls back the whole transaction.
- [ ] Verify each conversation lookup scopes to `workspace_id`; record `conversation.*` and `message.*` activities.

### Task 2: Inbox server API

**Files:**
- Create: `app/api/inbox/conversations/route.ts`
- Create: `app/api/inbox/conversations/[conversationId]/route.ts`
- Create: `app/api/inbox/conversations/[conversationId]/messages/route.ts`
- Create: `app/api/inbox/conversations/[conversationId]/read/route.ts`

**Interfaces:**
- `GET/POST /api/inbox/conversations`
- `GET/PATCH /api/inbox/conversations/:conversationId`
- `GET/POST /api/inbox/conversations/:conversationId/messages`
- `PATCH /api/inbox/conversations/:conversationId/read`

- [ ] Return `404` for cross-workspace conversation, message, draft, archive, and read operations.
- [ ] Reject a foreign or archived Contact with a safe `400` on creation.
- [ ] Only allow locally persisted drafts from the reply zone; no route returns a false sent/provider state.
- [ ] Keep list previews to the latest non-draft message and sort by `last_message_at desc` without N+1 queries.

### Task 3: Migrate InboxClient data flow

**Files:**
- Modify: `app/app/inbox/InboxClient.tsx`
- Modify: `app/app/inbox/inbox-model.ts` only if a mapping type is required

**Interfaces:**
- Consumes the Task 2 API.
- Retains sandbox state only for temporary Automatisations compatibility; it is not used for Inbox rendering or writes.

- [ ] Fetch conversations and messages with loading/error/empty states.
- [ ] Replace sandbox conversation/message dispatches with API operations.
- [ ] Wire search and filters to returned PostgreSQL fields: all, unread, channel, archived.
- [ ] Save reply text as a clearly labelled draft and allow updating/removing drafts.
- [ ] Mark open conversations read and preserve archive/reopen controls.

### Task 4: Reproducible security and persistence validation

**Files:**
- Create: `scripts/validate-inbox.mjs`
- Modify: `package.json`
- Modify: `.gitignore` only if no existing `validation/*.json` rule covers it.

**Interfaces:**
- Adds `npm run test:inbox:validation`.
- Writes `validation/inbox-validation.json` after every scenario.

- [ ] Provision User A/B, create Contacts A/B, then create Conversation A with Contact A and ordered inbound/draft/inbound messages.
- [ ] Assert participants, history ordering, draft persistence, unread/read persistence, archive/reopen and relogin persistence.
- [ ] Assert foreign contact creation is rejected and transaction failure leaves no partial conversation.
- [ ] Assert B receives `404` for read, message history, draft, archive and mark-read attempts on Conversation A.
- [ ] Assert duplicate non-null provider message IDs do not create two messages, without a provider call.

### Task 5: Verification and handoff

**Files:**
- Modify only files needed for Inbox regressions discovered during checks.

- [ ] Run the persisted validation report and inspect PASS/FAIL codes.
- [ ] Run `npm run lint`.
- [ ] Run `npx tsc --noEmit`, separating the seven known Contacts/Sandbox test failures from Inbox.
- [ ] Run `npm run build`; if output is cut during optimization, report the last observed stage without calling it successful.
- [ ] Commit/push, report schema choices and stop before Automatisations.

## Self-review

- Existing conversation, participant, message and attachment tables are extended rather than duplicated.
- Drafts cannot appear as provider-sent messages, unread is per user, and no external sender is introduced.
- All required cross-workspace, rollback, archive/reopen, unread, relogin and provider-id scenarios are covered by Task 4.
