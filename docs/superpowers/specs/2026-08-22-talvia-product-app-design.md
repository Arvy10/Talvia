# Talvia Product App Design

## Goal

Build the complete interior of the Talvia application as a responsive, frontend-only sandbox. The existing landing page, branding, logo, login page, and signup page remain visually unchanged. Onboarding is explicitly postponed.

The sandbox starts with no connected channels, no contacts, no conversations, no opportunities, no revenue, and no AI-generated metrics. A locally persisted demo session lets the same tester return without creating an account again.

## Scope

The product includes these routes:

- `/app` — Aujourd’hui dashboard
- `/app/inbox` — unified inbox
- `/app/opportunities` — sales pipeline
- `/app/contacts` — contact workspace
- `/app/automations` — automation library and builder
- `/app/connections` — LinkedIn, WhatsApp, and Gmail connections
- `/app/settings` — sandbox and product preferences

The following are excluded from this iteration:

- onboarding screens or route
- a backend, database, or real OAuth flow
- real credentials or personal data in browser storage
- Instagram or any channel other than LinkedIn, WhatsApp, and Gmail
- fabricated users, messages, contacts, opportunities, scores, metrics, or charts
- changes to the public landing page or its visual identity

## Product Architecture

The app uses the existing Next.js 16 App Router, React 19, TypeScript, and Tailwind CSS 4 stack. A shared `app/app/layout.tsx` owns the persistent product shell. Route pages remain small and compose focused product components.

A single client-side sandbox provider owns the mutable demo state. It exposes typed actions through a reducer and persists a versioned, non-sensitive snapshot in `localStorage`. Pages read the same state, so a connection made on the Connections page is immediately reflected in the dashboard, inbox filters, and other relevant surfaces. Hydration begins from deterministic defaults and then restores the saved snapshot after mount to avoid server/client markup mismatches.

The persisted snapshot contains only:

- a boolean sandbox session flag
- connection status for LinkedIn, WhatsApp, and Gmail
- lightweight product preferences such as pipeline view
- a schema version for future migrations

It never contains passwords, OAuth tokens, real email addresses, or real social account identifiers.

## Navigation and Shell

Desktop uses a fixed-width left sidebar with the Talvia wordmark, primary navigation, a divider, utility navigation, and a compact sandbox account footer. The active item receives a coral-tinted glass treatment. The main workspace has a restrained topbar for page title, contextual actions, and a mobile menu trigger.

Navigation order:

1. Aujourd’hui
2. Inbox
3. Opportunités
4. Contacts
5. Automatisations
6. separator
7. Connexions
8. Paramètres

Tablet collapses the sidebar to an icon rail while preserving tooltips and active-state clarity. Mobile replaces it with a slide-over drawer and uses single-column flows. No desktop three-panel layout is squeezed onto a phone.

The visual language extends the current Talvia system:

- page background: `#0D0B10`
- surface: `#16121B`
- elevated surface: `#201925`
- coral accent: `#FF6B4A`
- violet accent: `#8B5CF6`
- primary text: `#F7F4F8`
- muted text: `#A9A2AE`
- border: `#2D2632`

Instrument Sans remains the interface typeface. Instrument Serif appears selectively in empty-state headlines and editorial section titles, at a smaller scale and lower visual weight than the landing hero. Surfaces use subtle borders, dark translucency, restrained blur, and coral/violet ambient highlights. Every interactive control has a visible hover, focus, pressed, and disabled state. Motion respects `prefers-reduced-motion`.

UI actions use one coherent Lucide-style icon family. LinkedIn, WhatsApp, and Gmail use recognizable brand marks in their official brand colors and are the only icon-family exceptions.

## Screen Design

### Aujourd’hui

The dashboard greets the tester with a concise product headline and a setup-progress strip based only on real sandbox state. Empty summary cards explain what will appear after channels are connected; they do not show zero-valued vanity metrics as if activity exists. The primary action points to Connexions. Secondary shortcuts lead to Inbox, Contacts, and Automatisations.

### Inbox

Desktop uses three zones: conversation list, selected conversation, and contextual contact panel. With no conversations, the list shows channel filters and an empty-state explanation; the center explains that synchronized conversations will appear after a connection; the context panel remains explicitly unselected. Mobile turns these into a progressive list → conversation → details flow.

Filters show LinkedIn, WhatsApp, and Gmail with their true logos. Disconnected channels are visibly unavailable without being mistaken for errors. Connected-but-empty channels display a legitimate empty state.

### Opportunités

The page offers list and pipeline toggles. The default pipeline has empty columns for Nouveau, Qualifié, Proposition, Négociation, and Gagné. Columns show instructional empty zones, not invented cards or totals. The primary action opens a lightweight local modal for creating an opportunity, but no prefilled fictional person or company is used.

### Contacts

The contacts workspace includes search, channel filter, connection-state guidance, an empty collection panel, and an unselected details panel on wide screens. A create-contact action may store only data deliberately typed by the tester. No demo contacts are seeded.

### Automatisations

The initial screen distinguishes user-created automations, which are empty, from product-authored templates, which are allowed because they are capabilities rather than fake activity. Templates include examples such as follow-up after no reply, Gmail lead routing, and WhatsApp qualification. Opening a template launches a simple modal builder with trigger, channel, action, and active/inactive controls. Created automations persist locally.

### Connexions

This is the central setup surface. Three dedicated cards use the real LinkedIn, WhatsApp, and Gmail marks, explain each integration, and expose its current state.

Each channel supports these sandbox states:

- `disconnected`
- `connecting`
- `syncing`
- `connected`
- `error`

The normal action sequence is disconnected → connecting → syncing → connected. Timed transitions are short, visible, cancellable when the component unmounts, and persisted only when a stable state is reached. Connected cards provide Manage and Disconnect actions. Error cards provide Retry.

A compact, clearly labeled “Tester les états” sandbox control allows visual inspection of every status without pretending that real OAuth occurred. It is confined to the Connections page and can reset all channels to the clean initial state.

### Paramètres

Settings contains product preferences, sandbox-session information, motion preference guidance, and a clearly separated destructive action to reset local Talvia sandbox data. Reset requires confirmation and restores the initial disconnected, empty state without changing public landing or authentication styling.

## Data and Interaction Flow

The reducer is the only state mutation boundary. Route components dispatch semantic actions such as `START_CONNECTION`, `SET_CONNECTION_STATUS`, `DISCONNECT_CHANNEL`, `CREATE_CONTACT`, `CREATE_OPPORTUNITY`, `CREATE_AUTOMATION`, `SET_PIPELINE_VIEW`, and `RESET_SANDBOX`.

Connection-derived UI is computed from the shared state rather than duplicated. For example, inbox filter availability and dashboard setup progress both read the same channel map. This prevents routes from disagreeing after navigation or refresh.

Login and signup forms remain visually unchanged. Successful local submission sets the sandbox session flag and navigates to `/app`. Direct access to `/app` in this frontend-only version also initializes the persistent sandbox session so local product testing is never blocked by mock authentication. This is explicitly a prototype convenience, not a security boundary.

## Empty, Loading, and Error States

Every route must render meaningful content in an all-empty installation. Empty states explain why the area is empty, what will eventually appear, and the single best next action. They use product language and concise guidance rather than generic “No data” labels.

Loading is represented with localized skeletons or progress indicators, never by blocking the entire shell. Connection errors stay scoped to their card and offer Retry. Unexpected client storage failures fall back to in-memory defaults; the app remains usable and shows a non-blocking sandbox notice. All modals can be dismissed with Escape and restore focus to their trigger.

## Accessibility and Responsive Behaviour

- All navigation and actions are keyboard reachable.
- Focus rings meet contrast requirements against dark glass surfaces.
- Icon-only buttons have accessible names and tooltips where meaning is not obvious.
- Drawers and modals trap focus while open and return focus when closed.
- Brand color is never the only status signal; labels and icons accompany it.
- Desktop, tablet, and mobile layouts are intentionally composed rather than merely scaled.
- Hover-only information is also available through focus or persistent labels.

## Testing and Acceptance

The implementation is complete when:

- all seven routes render without runtime errors
- the desktop sidebar, tablet rail, and mobile drawer navigate correctly
- all channels begin disconnected on a fresh sandbox
- each connection status can be reached and visually verified
- stable connection states survive reloads
- resetting the sandbox clears local product data and restores disconnected states
- empty Inbox, Opportunities, Contacts, and user Automations contain no fabricated activity
- recognizable LinkedIn, WhatsApp, and Gmail logos appear in dedicated integration and channel surfaces
- dialogs and navigation work by keyboard
- layouts remain usable at representative mobile, tablet, laptop, and wide-desktop widths
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass
- the existing landing page remains visually and functionally intact

## Implementation Boundaries

Components are split by product responsibility rather than collected into one large file. Shared primitives cover only recurring patterns such as glass cards, status badges, empty states, icon buttons, dialogs, and page headers. Product-specific components stay beside the feature that owns them. This keeps the code straightforward today and leaves clean seams for replacing local sandbox actions with backend calls later.
