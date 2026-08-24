# Talvia Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current sidebar controls with a responsive Talvia navigation headed by an icon-only brand toggle.

**Architecture:** `AppShell` remains the owner of desktop collapse and mobile drawer state. `Sidebar` renders the shared navigation for both contexts; `Topbar` no longer owns a navigation control. CSS retains Talvia tokens and scopes responsive presentation to the existing application shell.

**Tech Stack:** Next.js client components, TypeScript, React, CSS, react-icons.

## Global Constraints

- Preserve existing routes and navigation order.
- Rename only `/app` from `Aujourd’hui` to `Vue d’ensemble`.
- Keep desktop preference in `localStorage` under `talvia:sidebar-collapsed`.
- Add no dependency or external call.
- Maintain keyboard focus, Escape dismissal, and mobile drawer behavior.

---

### Task 1: Navigation labels and shared sidebar command

**Files:**

- Modify: `app/app/components/navigation.ts`
- Modify: `app/app/components/Sidebar.tsx`

**Interfaces:**

- Consumes: `productNavigation`, `SidebarProps`.
- Produces: `onToggle?: () => void` on `SidebarProps`; the brand control invokes it only when supplied.

- [ ] **Step 1: Write the failing test**

Create `app/app/components/Sidebar.test.tsx`. Render the sidebar with `collapsed={false}` and assert a button named `Réduire la navigation`; rerender with `collapsed={true}` and assert `Agrandir la navigation`.

- [ ] **Step 2: Run the test**

Run `npm test -- --run app/app/components/Sidebar.test.tsx`; it should fail because the brand is currently a link.

- [ ] **Step 3: Implement**

Change the first label to `Vue d’ensemble`. When `onToggle` is supplied, render the sidebar brand as a button with an accessible reduced/expanded label. Retain a link in the mobile drawer. Remove `sidebar-collapse-button` and its chevron imports.

- [ ] **Step 4: Verify and commit**

Run the focused test, then commit `feat: make Talvia sidebar brand the toggle`.

### Task 2: Shell and topbar ownership

**Files:**

- Modify: `app/app/components/AppShell.tsx`
- Modify: `app/app/components/Topbar.tsx`

**Interfaces:**

- Consumes: `Sidebar` with `onToggle`, existing `openDrawer`, `drawerOpen`, and `sidebarCollapsed` state.
- Produces: a desktop brand toggle and mobile drawer navigation without a topbar hamburger.

- [ ] **Step 1: Write the failing test**

Create or extend `app/app/components/AppShell.test.tsx` to assert the desktop sidebar receives the toggle callback and `Topbar` does not render `Ouvrir la navigation`.

- [ ] **Step 2: Run the test**

Run `npm test -- --run app/app/components/AppShell.test.tsx`; it should fail because `Topbar` currently renders `onMenuOpen`.

- [ ] **Step 3: Implement**

Pass `toggleSidebar` to the desktop `Sidebar`. Keep the modal drawer for mobile through the responsive brand command. Remove `LuMenu`, `IconButton`, and `onMenuOpen` from `Topbar`; retain title, sandbox status, and logout.

- [ ] **Step 4: Verify and commit**

Run the focused test, then commit `refactor: move navigation control into Talvia sidebar`.

### Task 3: Responsive visual hierarchy

**Files:**

- Modify: `app/app/app.css`
- Modify: `app/app/v2.css`

**Interfaces:**

- Consumes: `app-sidebar`, `app-brand`, `app-navigation`, `app-drawer`, and `is-collapsed` CSS classes.
- Produces: grouped hierarchy, icon-only reduced rail, mobile drawer trigger, and visible focus states.

- [ ] **Step 1: Implement CSS**

Adjust sidebar spacing, group labels, active rail, footer separation, and brand hover/focus behavior in `app.css`. Remove obsolete collapse-button CSS from `v2.css`. At `max-width:767px`, make the Talvia mark the drawer trigger while the primary rail remains hidden.

- [ ] **Step 2: Build**

Run `npm run build`; it must complete without TypeScript or route errors.

- [ ] **Step 3: Validate**

At 1440px, 900px, and 390px verify groups and labels, icon-only reduced rail, full-height mobile drawer, no hamburger, no `Réduire`, keyboard Tab, and Escape dismissal.

- [ ] **Step 4: Commit**

Commit `style: refine responsive Talvia sidebar`.

## Self-review

- The tasks cover the logo command, removal of both old controls, mobile drawer, label rename, preserved order, persistent desktop state, and keyboard behavior.
- The plan introduces no route, storage schema, dependency, or external API change.
