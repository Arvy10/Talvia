# Talvia Auth Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split login/signup layout with a Talvia curved-panel transition.

**Architecture:** Keep Better Auth submissions in `AuthClient`; add only client-side animation state. Rebuild auth presentation with CSS using existing Talvia visual tokens.

**Tech Stack:** Next.js, React, TypeScript, CSS, Better Auth.

## Global Constraints

- Reuse only existing Talvia colors, text, typography, and logo.
- Keep `/login` and `/signup` valid direct URLs.
- Do not modify Better Auth, Neon, APIs, or email verification.
- Respect reduced motion and keyboard access.

### Task 1: Add animated mode navigation

**Files:**
- Modify: `app/components/AuthClient.tsx`
- Modify: `app/components/ui/auth-switch.tsx`

- [ ] Add `transitionTarget` state and a `navigateMode(target)` callback.
- [ ] Have the mode buttons use the callback and delay `router.push()` by 420ms.
- [ ] Keep every form submission path unchanged.
- [ ] Manually verify keyboard activation does not submit the form.
- [ ] Commit with `git commit -m "feat: animate Talvia auth mode navigation"`.

### Task 2: Rebuild the card and curved panel

**Files:**
- Modify: `app/components/AuthClient.tsx`
- Modify: `app/globals.css`
- Modify: `app/components/ui/auth-switch.module.css`

- [ ] Render one `.auth-card` containing the form region and a non-submit panel action region.
- [ ] Position the panel with an elliptical `clip-path` and animate `transform` and `clip-path` for 420ms.
- [ ] Use only existing Talvia dark, coral, violet, text and border tokens; no reference colors.
- [ ] Verify `/login` and `/signup` begin with the panel on opposite sides.
- [ ] Commit with `git commit -m "feat: redesign Talvia auth card motion"`.

### Task 3: Add fallbacks and validate

**Files:**
- Modify: `app/globals.css`

- [ ] Hide the decorative panel and use a one-column form below 900px.
- [ ] Disable transitions under `prefers-reduced-motion: reduce`.
- [ ] Run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Commit and push the completed feature to `feature/product-app`.
