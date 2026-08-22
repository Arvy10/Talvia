# Talvia Product App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Talvia’s complete responsive product interior as an empty, locally persisted frontend sandbox without changing the public landing page.

**Architecture:** A shared Next.js App Router layout owns the responsive product shell, while focused route components compose reusable glass UI primitives. A typed React reducer and versioned localStorage adapter provide one source of truth for sandbox session, channel connections, user-created records, and preferences.

**Tech Stack:** Next.js 16.2.6, React 19.2.6, TypeScript 5.9.3, Tailwind CSS 4.2.1, React Icons, Vitest, Testing Library, jsdom.

## Global Constraints

- Keep the existing landing page, branding, logo, `/login`, and `/signup` visual design intact.
- Do not create onboarding screens or an `/app/onboarding` route.
- Do not add a backend, database, real OAuth, credentials, tokens, or personal data to storage.
- A fresh sandbox has no connected channels, contacts, conversations, opportunities, revenue, scores, metrics, or seeded user activity.
- Support exactly LinkedIn, WhatsApp, and Gmail in this iteration.
- Use recognizable official brand marks and official brand colors only for those three integrations.
- Use the existing Talvia palette: `#0D0B10`, `#16121B`, `#201925`, `#FF6B4A`, `#8B5CF6`, `#F7F4F8`, `#A9A2AE`, `#2D2632`.
- Preserve Instrument Sans for interface text and use Instrument Serif selectively for secondary editorial headlines.
- Persist stable sandbox state locally and recover safely to defaults if browser storage fails.
- Every interactive control needs hover, focus, pressed, disabled, keyboard, and reduced-motion behavior.
- Verify the app at mobile, tablet, laptop, and wide-desktop widths.

---

### Task 1: Add the test harness, icons, and sandbox state core

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `app/app/state/types.ts`
- Create: `app/app/state/reducer.ts`
- Create: `app/app/state/storage.ts`
- Create: `app/app/state/SandboxProvider.tsx`
- Create: `app/app/state/reducer.test.ts`
- Create: `app/app/state/storage.test.ts`

**Interfaces:**
- Produces: `ChannelId`, `ConnectionStatus`, `SandboxState`, `SandboxAction`, `initialSandboxState`, `sandboxReducer`, `loadSandboxState`, `saveSandboxState`, `SandboxProvider`, and `useSandbox()`.
- Storage key: `talvia:sandbox:v1`.

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```powershell
npm install react-icons
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected: `package.json` and `package-lock.json` include the new dependencies without changing the existing Next.js, React, Tailwind, or font versions.

- [ ] **Step 2: Add test scripts and Vitest configuration**

Add these scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

- [ ] **Step 3: Write failing reducer tests**

Cover these exact behaviors in `app/app/state/reducer.test.ts`:

```ts
expect(initialSandboxState.connections.linkedin.status).toBe("disconnected");
expect(initialSandboxState.connections.whatsapp.status).toBe("disconnected");
expect(initialSandboxState.connections.gmail.status).toBe("disconnected");

const connected = sandboxReducer(initialSandboxState, {
  type: "SET_CONNECTION_STATUS",
  channel: "linkedin",
  status: "connected",
});
expect(connected.connections.linkedin.status).toBe("connected");

const reset = sandboxReducer(connected, { type: "RESET_SANDBOX" });
expect(reset).toEqual(initialSandboxState);
```

Also assert that `CREATE_CONTACT`, `CREATE_OPPORTUNITY`, `CREATE_AUTOMATION`, and `SET_PIPELINE_VIEW` update only their owned state.

- [ ] **Step 4: Run reducer tests and verify failure**

Run: `npm test -- app/app/state/reducer.test.ts`

Expected: FAIL because the state modules do not exist.

- [ ] **Step 5: Implement typed reducer state**

Use these stable unions in `types.ts`:

```ts
export type ChannelId = "linkedin" | "whatsapp" | "gmail";
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";
export type PipelineView = "pipeline" | "list";
```

Define `SandboxState` with `schemaVersion: 1`, `sessionActive`, a record for all three connections, empty arrays for contacts, opportunities, and automations, and `pipelineView: "pipeline"`. Implement semantic reducer actions and immutable updates.

- [ ] **Step 6: Write failing storage tests**

Assert that `loadSandboxState()` returns defaults for missing, malformed, or wrong-version values; returns a valid saved snapshot; and never throws when `localStorage.getItem` or `setItem` throws.

- [ ] **Step 7: Implement versioned storage and provider**

`SandboxProvider` initializes with deterministic defaults, restores storage in an effect, marks hydration complete, saves stable state changes, and exposes:

```ts
type SandboxContextValue = {
  state: SandboxState;
  hydrated: boolean;
  dispatch: React.Dispatch<SandboxAction>;
};
```

Storage errors set an in-memory `storageAvailable: false` flag and do not block rendering.

- [ ] **Step 8: Run core verification and commit**

Run:

```powershell
npm test -- app/app/state
npx tsc --noEmit
npm run lint
```

Expected: all commands pass.

Commit:

```powershell
git add package.json package-lock.json vitest.config.ts app/app/state
git commit -m "feat: add Talvia sandbox state core"
```

### Task 2: Build the responsive product shell and shared UI primitives

**Files:**
- Create: `app/app/app.css`
- Create: `app/app/layout.tsx`
- Create: `app/app/components/AppShell.tsx`
- Create: `app/app/components/Sidebar.tsx`
- Create: `app/app/components/Topbar.tsx`
- Create: `app/app/components/ui.tsx`
- Create: `app/app/components/Dialog.tsx`
- Create: `app/app/components/navigation.ts`
- Create: `app/app/components/navigation.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `SandboxProvider`, `useSandbox()`.
- Produces: `AppShell`, `PageHeader`, `GlassCard`, `StatusBadge`, `EmptyState`, `IconButton`, `Dialog`, and `productNavigation`.

- [ ] **Step 1: Write failing navigation tests**

Assert that `productNavigation` contains exactly these hrefs in order:

```ts
[
  "/app",
  "/app/inbox",
  "/app/opportunities",
  "/app/contacts",
  "/app/automations",
  "/app/connections",
  "/app/settings",
]
```

Assert that each item has a French label and icon component.

- [ ] **Step 2: Implement navigation and shell structure**

Use `LuHouse`, `LuInbox`, `LuChartNoAxesColumnIncreasing`, `LuUsers`, `LuWorkflow`, `LuUnplug`, and `LuSettings` from `react-icons/lu`. `AppShell` controls a keyboard-accessible mobile drawer and derives active state from `usePathname()`.

- [ ] **Step 3: Implement shared primitives**

Build typed primitives with `className` extension and semantic HTML. `Dialog` must close on Escape, close on backdrop click, trap Tab within its controls, set `aria-modal="true"`, and restore focus to the opening trigger.

- [ ] **Step 4: Implement responsive Talvia styling**

In `app.css`, define the exact product palette as CSS custom properties, shared glass surface styles, active navigation, hover/focus states, skeleton animation, dialog/drawer behavior, and reduced-motion overrides. Use these layout breakpoints:

- below `768px`: drawer and single-column pages
- `768px` to `1099px`: icon rail and compact split layouts
- `1100px` and above: full sidebar and desktop workspaces

- [ ] **Step 5: Wire the route-group layout**

`app/app/layout.tsx` imports `app.css`, wraps all product routes in `SandboxProvider`, and renders `AppShell`. It must not modify `app/layout.tsx` metadata or the public page structure.

- [ ] **Step 6: Verify shell and commit**

Run:

```powershell
npm test -- app/app/components/navigation.test.ts
npx tsc --noEmit
npm run lint
```

Expected: all commands pass.

Commit:

```powershell
git add app/app app/globals.css
git commit -m "feat: add responsive Talvia app shell"
```

### Task 3: Implement Connections and real channel branding

**Files:**
- Create: `app/app/connections/page.tsx`
- Create: `app/app/connections/ConnectionsClient.tsx`
- Create: `app/app/connections/ChannelLogo.tsx`
- Create: `app/app/connections/connection-flow.ts`
- Create: `app/app/connections/connection-flow.test.ts`

**Interfaces:**
- Consumes: `ChannelId`, `ConnectionStatus`, `useSandbox()`, `GlassCard`, `StatusBadge`, `Dialog`.
- Produces: `ChannelLogo`, `getNextConnectionStatus(status)`, and the complete Connections route.

- [ ] **Step 1: Write failing transition tests**

Assert this state machine:

```ts
expect(getNextConnectionStatus("disconnected")).toBe("connecting");
expect(getNextConnectionStatus("connecting")).toBe("syncing");
expect(getNextConnectionStatus("syncing")).toBe("connected");
expect(getNextConnectionStatus("error")).toBe("connecting");
expect(getNextConnectionStatus("connected")).toBe("connected");
```

- [ ] **Step 2: Implement brand marks and status copy**

Use `SiLinkedin`, `SiWhatsapp`, and `SiGmail` from `react-icons/si` with official colors `#0A66C2`, `#25D366`, and `#EA4335`. Keep logo containers neutral and pair every color signal with a visible text label.

- [ ] **Step 3: Implement normal connection behavior**

Each Connect action dispatches `connecting`, schedules `syncing`, then schedules `connected`. Clear pending timers during unmount. Disconnect opens a confirmation dialog and returns the channel to `disconnected`. Retry restarts the same sequence.

- [ ] **Step 4: Implement the sandbox state tester**

Add a compact disclosure labeled `Tester les états`. It provides a status selector for each channel and a `Tout réinitialiser` action. The control must be visually secondary and confined to this route.

- [ ] **Step 5: Verify route and commit**

Run:

```powershell
npm test -- app/app/connections
npx tsc --noEmit
npm run lint
```

Expected: all commands pass and `/app/connections` shows three disconnected branded cards on a fresh sandbox.

Commit:

```powershell
git add app/app/connections
git commit -m "feat: add sandbox channel connections"
```

### Task 4: Implement Aujourd’hui and the unified empty Inbox

**Files:**
- Create: `app/app/page.tsx`
- Create: `app/app/dashboard/DashboardClient.tsx`
- Create: `app/app/inbox/page.tsx`
- Create: `app/app/inbox/InboxClient.tsx`
- Create: `app/app/inbox/inbox-model.ts`
- Create: `app/app/inbox/inbox-model.test.ts`

**Interfaces:**
- Consumes: shared shell primitives, `ChannelLogo`, and `useSandbox()`.
- Produces: `getConnectedChannelCount(state)`, `getInboxAvailability(connections)`, dashboard, and inbox routes.

- [ ] **Step 1: Write failing derived-state tests**

Assert that a fresh sandbox reports zero connected channels and all inbox channel filters unavailable. Assert that connecting Gmail reports one connected channel and enables only Gmail without manufacturing conversations.

- [ ] **Step 2: Implement the dashboard**

Render an editorial welcome, truthful setup progress derived from the three channel statuses, a Connexions primary CTA, and shortcuts to Inbox, Contacts, and Automatisations. Empty summary cards describe future content and contain no numeric activity metrics.

- [ ] **Step 3: Implement the inbox workspace**

Desktop renders conversation list, empty conversation canvas, and unselected context panel. Tablet uses a compact two-zone split. Mobile starts with filters and the empty list, using explicit back controls for future progressive navigation. Brand-logo filters show disconnected, connected-empty, syncing, and error states.

- [ ] **Step 4: Verify routes and commit**

Run:

```powershell
npm test -- app/app/inbox
npx tsc --noEmit
npm run lint
```

Expected: commands pass; both routes remain meaningful with no activity.

Commit:

```powershell
git add app/app/page.tsx app/app/dashboard app/app/inbox
git commit -m "feat: add Talvia dashboard and inbox"
```

### Task 5: Implement empty Opportunities and Contacts workspaces

**Files:**
- Create: `app/app/opportunities/page.tsx`
- Create: `app/app/opportunities/OpportunitiesClient.tsx`
- Create: `app/app/opportunities/pipeline.ts`
- Create: `app/app/opportunities/pipeline.test.ts`
- Create: `app/app/contacts/page.tsx`
- Create: `app/app/contacts/ContactsClient.tsx`

**Interfaces:**
- Consumes: `useSandbox()`, `Dialog`, `EmptyState`, `ChannelLogo`.
- Produces: `PIPELINE_STAGES`, opportunity creation flow, contact creation flow, and both routes.

- [ ] **Step 1: Write failing pipeline tests**

Assert this ordered stage model:

```ts
[
  ["new", "Nouveau"],
  ["qualified", "Qualifié"],
  ["proposal", "Proposition"],
  ["negotiation", "Négociation"],
  ["won", "Gagné"],
]
```

Assert that switching `pipelineView` persists through the reducer.

- [ ] **Step 2: Implement Opportunities**

Render pipeline/list toggles, five truthful empty columns, and a creation dialog with required title, optional organization, stage selection, and submit validation. Persist only values typed by the tester.

- [ ] **Step 3: Implement Contacts**

Render search, channel filter, empty collection, and unselected detail panel. The create dialog accepts a required display name and optional email, phone, and channel. Do not seed or prefill identity data.

- [ ] **Step 4: Verify routes and commit**

Run:

```powershell
npm test -- app/app/opportunities
npx tsc --noEmit
npm run lint
```

Expected: commands pass; fresh routes show no cards, contacts, totals, or fictional names.

Commit:

```powershell
git add app/app/opportunities app/app/contacts
git commit -m "feat: add opportunities and contacts workspaces"
```

### Task 6: Implement Automations and Settings

**Files:**
- Create: `app/app/automations/page.tsx`
- Create: `app/app/automations/AutomationsClient.tsx`
- Create: `app/app/automations/templates.ts`
- Create: `app/app/automations/templates.test.ts`
- Create: `app/app/settings/page.tsx`
- Create: `app/app/settings/SettingsClient.tsx`

**Interfaces:**
- Consumes: `useSandbox()`, `Dialog`, `GlassCard`, `ChannelLogo`.
- Produces: `AUTOMATION_TEMPLATES`, local automation creation, preferences, and sandbox reset.

- [ ] **Step 1: Write failing template tests**

Assert that template IDs are unique, every template references one of `linkedin`, `whatsapp`, or `gmail`, and template copy describes a product capability without a person, company, performance result, or activity count.

- [ ] **Step 2: Implement Automations**

Separate the empty `Vos automatisations` region from the product-authored template library. The builder dialog includes name, trigger, channel, action, and enabled state. A template supplies workflow configuration only; it never supplies fake recipients or results.

- [ ] **Step 3: Implement Settings**

Render sandbox session information, product preferences, storage availability notice, and a danger-zone reset dialog. Confirmed reset dispatches `RESET_SANDBOX`, closes the dialog, and announces completion through an `aria-live` region.

- [ ] **Step 4: Verify routes and commit**

Run:

```powershell
npm test -- app/app/automations
npx tsc --noEmit
npm run lint
```

Expected: commands pass; templates are clearly distinct from zero user-created automations.

Commit:

```powershell
git add app/app/automations app/app/settings
git commit -m "feat: add automations and sandbox settings"
```

### Task 7: Connect local authentication and complete end-to-end verification

**Files:**
- Modify: `app/components/AuthClient.tsx`
- Modify: `app/login/page.tsx` only if required to pass the existing mode prop
- Modify: `app/signup/page.tsx` only if required to pass the existing mode prop
- Create: `app/app/state/session.ts`
- Create: `app/app/state/session.test.ts`

**Interfaces:**
- Consumes: storage key `talvia:sandbox:v1` and existing `AuthClient` form modes.
- Produces: `activateSandboxSession()` and redirect to `/app` after successful local submit.

- [ ] **Step 1: Write failing session tests**

Assert that `activateSandboxSession(existingState)` returns the same product data with `sessionActive: true`, and that malformed storage starts from `initialSandboxState` with an active session. Assert that no password argument or password field exists in the session function or persisted state.

- [ ] **Step 2: Implement local session activation**

On successful login or signup validation, save the active sandbox state and call `router.push("/app")`. Keep all existing auth markup and CSS classes unchanged. Never save form passwords or email values.

- [ ] **Step 3: Run the full automated verification**

Run:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all four commands pass.

- [ ] **Step 4: Perform route and responsive smoke checks**

With the local server running, verify HTTP 200 and usable layouts for all routes at `390x844`, `820x1180`, `1440x900`, and `1920x1080`. Check:

- mobile drawer open, close, Escape, and navigation
- tablet icon rail and tooltips
- desktop sidebar active states
- connection sequence, error preview, retry, disconnect, and reload persistence
- empty inbox channel availability
- pipeline/list toggle persistence
- contact, opportunity, and automation modal validation
- reset confirmation and return to the fully disconnected empty state
- keyboard focus order and reduced-motion behavior
- unchanged `/`, `/login`, and `/signup` presentation

- [ ] **Step 5: Fix only defects found by verification and rerun checks**

Run again after fixes:

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all commands pass and `git diff --check` prints no errors.

- [ ] **Step 6: Commit the completed product interior**

```powershell
git add app package.json package-lock.json vitest.config.ts
git commit -m "feat: complete Talvia product sandbox"
```

## Final Acceptance Checklist

- [ ] Seven product routes are implemented and navigable.
- [ ] Fresh state contains no fabricated content or connected account.
- [ ] LinkedIn, WhatsApp, and Gmail have recognizable logos and testable states.
- [ ] Stable sandbox data persists, and reset returns to clean defaults.
- [ ] Mobile, tablet, laptop, and wide-desktop compositions are usable.
- [ ] Landing and authentication visuals are unchanged.
- [ ] Tests, lint, TypeScript, production build, and diff checks pass.
