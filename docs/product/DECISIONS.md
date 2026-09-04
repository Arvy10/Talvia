# Talvia Product Decision Log

This file records durable product and architectural decisions.

Do not use it as a daily changelog.

Add entries only when the decision should influence future development.

---

## 2026-08 — Talvia product model

**Decision**

Talvia is a conversational sales operating system connecting:

**Approach → Conversation → Contact/context → Follow-up → Qualification → Opportunity → Conversion**

**Reason**

Talvia should not drift into becoming only a shared inbox or generic CRM.

---

## 2026-08 — Inbox source of truth

**Decision**

Once a real conversation begins, Inbox becomes the conversational source of truth.

**Reason**

Commercial relationships should not remain fragmented between campaigns and message providers.

---

## 2026-08 — Reply does not equal Opportunity

**Decision**

A reply does not automatically create an Opportunity.

Opportunity creation requires sufficient commercial signal or qualification.

**Reason**

Replies may be negative, informational, neutral, or unrelated to sales potential.

---

## 2026-08 — Campaigns vs Automations

**Decision**

Campaigns and Automations remain separate systems.

Campaigns owns ordered commercial sequences and participant execution state.

Automations owns event-triggered business reactions.

**Reason**

Combining both would make sequence logic harder to reason about and weaken domain boundaries.

---

## 2026-08 — LinkedIn campaign behavior

**Decision**

LinkedIn Campaigns should execute controlled outreach workflows.

When a participant replies, future sequence steps stop immediately and Inbox becomes the conversational source of truth.

**Reason**

Continuing automated outreach after a real reply damages the relationship and creates spam-like behavior.

---

## 2026-08 — WhatsApp positioning

**Decision**

WhatsApp is primarily a follow-up, re-engagement, existing-lead, former-client, and conversion channel.

Talvia should not be designed around mass cold WhatsApp outreach.

**Reason**

The product philosophy prioritizes relationship quality, relevant follow-up, and controlled sales behavior.

---

## 2026-08 — AI is a layer, not the product

**Decision**

AI supports Talvia across modules but is not Talvia's core positioning.

**Reason**

The defensible product value should come from context, workflow, provider integrations, memory, and execution—not from competing directly on foundation models.

---

## 2026-08 — Business Context

**Decision**

Business Context is a workspace-scoped understanding of the company using Talvia.

It can support Inbox, Campaigns, prospecting, qualification, Automations, reply preparation, and recommendations.

**Reason**

Business Context should become reusable product infrastructure rather than remain an onboarding-only feature.

---

## 2026-08 — Human Business Context edits

**Decision**

User-provided Business Context data takes precedence over automatic re-analysis.

Automatic analysis must not silently overwrite manually edited fields.

**Reason**

Human intent is authoritative and AI inference may be wrong.

---

## 2026-08 — Provider abstraction

**Decision**

External providers such as Unipile are infrastructure, not Talvia's domain model.

Provider-specific objects should be normalized through adapters into Talvia-owned entities.

**Reason**

Avoid vendor lock-in and prevent provider details from spreading throughout the application.

---

## 2026-08 — Onboarding philosophy

**Decision**

Onboarding asks the minimum needed to start.

Advanced Business Context remains available later in settings.

**Reason**

The user should not have to configure a CRM or marketing strategy before seeing value.

---

## 2026-08 — Beta launch philosophy

**Decision**

Talvia should launch a private beta once one real commercial loop is functional, even if many planned features are incomplete.

**Reason**

Real user feedback is now more valuable than continued speculative polish.

---

## 2026-08 — Initial integration priority

**Decision**

The next major product priority is real provider integration, starting with LinkedIn before expanding broadly.

**Reason**

Real conversations and real commercial workflows create more user value than further polishing secondary configuration surfaces.

---

## 2026-09 — Email channel foundation

**Decision**

Email becomes the third real channel, after LinkedIn and WhatsApp, and is built on the existing domain entities rather than new ones:

- an email thread is a `conversation` (`channel_type='email'`, keyed on the provider `thread_id` via `external_thread_id`) — no parallel `email_threads` table;
- an email address is a `contact_identity` (`channel_type='email'`), normalized the same way `contacts.ts` already normalizes a hand-entered address, so an inbound mail resolves to the Contact the user already knows;
- an email campaign runs on the SAME Campaign Engine, registered as one more `(channel, objective)` entry with its own executor — there is no second engine and no email-specific participant state.

Talvia's DOMAIN channel vocabulary is `linkedin | whatsapp | email`. `gmail` is a UI label only, converted once at the provider-adapter boundary.

**Reason**

Email's product role (follow-up, relances, proposals, re-engagement, controlled outbound) is the same commercial cycle the other channels serve. Modelling it separately would fragment the conversation source of truth and duplicate the stop/qualification rules that must stay identical across channels.

---

## 2026-09 — Email V1 requires an existing conversation

**Superseded on 2026-09-04 by "Email first touch" below.** Kept as the record of why the capability was deferred rather than improvised.

**Decision**

The V1 email executor only sends to a participant who already has a real email conversation. First-touch controlled outbound to a Contact whose address is known but who has no thread yet is deliberately deferred.

**Reason**

The provider only assigns a `thread_id` once a mail exists. Creating a conversation before that would require a Talvia-side placeholder thread key and reconciliation against the real thread later; done hastily this splits one human conversation across two Conversations. The capability is legitimate and planned — it needs its own design, not an improvised one.

---

## 2026-09 — Email first touch to a known address

**Decision**

An email campaign may send the FIRST mail of a relationship to a Contact whose email address Talvia already knows, with no pre-existing Conversation. This is not a second send path: it runs through the same Campaign Engine, the same claim/re-check sequence, the same `approvedText` requirement and the same `participant.id:step.id` idempotency key as a threaded reply. The shared executor simply gains one channel-supplied fallback for the case where there is nothing to reply into.

The thread problem the earlier decision identified is solved rather than avoided:

- Talvia sends first, then persists — never the reverse.
- The Conversation is keyed on the `provider_id` the send actually returned. That is a real provider identifier for that exact mail, not a Talvia-invented thread key, and the message records `threadResolution='pending_first_touch'` so it is never presented as a resolved thread.
- The `mail_sent` webhook carries both that `provider_id` and the canonical Unipile `email_id`. Reconciliation re-keys the Conversation onto the real thread and re-keys the existing message onto the canonical id — so the send response and the webhook produce ONE message, and a later historical import collapses onto it too.
- When the provider returns no identifier, nothing is fabricated: no Conversation is created, the send is still reported as done (never retried against a real person), and the participant carries `EMAIL_THREAD_RECONCILIATION_FAILED` until the webhook creates the Conversation normally.

The provisional Conversation carries `external_thread_id = NULL` — the column has been nullable since `005_inbox_persistence.sql`, and NULL means exactly "the provider has not told us the thread yet". The send response's `provider_id` is deliberately NOT parked there: it identifies a MESSAGE, and that column's `unique(connection_id, external_thread_id)` constraint defines THREAD identity. The cross-path key that ties one real mail together is `messages.metadata.emailProviderId`, which the send response, the `mail_sent` webhook and the historical import all write.

**Reconciliation applies to every mail Talvia sends, not only first touches.** A threaded reply is mirrored on the send response's `provider_id` and described again by the webhook under the canonical `email_id`; without reconciliation those two ids cannot be related, and one real email becomes two message rows and two `message.sent` activities. Whatever the arrival order of (send response, webhook, historical import), the outcome is one Conversation and one message.

**Residual risk, stated rather than papered over.** If the provider accepts a mail and its HTTP response is then lost, Talvia cannot know the mail went out. The `Idempotency-Key` header (`participant.id:step.id`, stable across retries) is the only thing that can stop a retry from sending a second real email, and that protection is the provider's, not Talvia's — this repository relies on Unipile's published behaviour for it and has never observed it. An outcome that is genuinely unknown (no answer at all, as opposed to an answer that refused) is recorded as `EMAIL_SEND_OUTCOME_UNKNOWN` and keeps its claim, so the retry waits out `CLAIM_STALE_AFTER` instead of firing on the next engine run. That narrows the window; it does not close it.

The subject line is user-authored and stored on `campaigns.settings.emailSubject`. Talvia never derives or invents one: without it a first touch is blocked with `EMAIL_SUBJECT_MISSING`.

Email eligibility is therefore deliberately DIFFERENT from WhatsApp's. WhatsApp requires a real existing Conversation (it is a relation-continuation channel, per the WhatsApp positioning decision above); email requires a real, usable address. Both rules are enforced server-side at audience selection AND re-checked before every send.

**Reason**

Follow-up, re-engagement and controlled outbound to people the user already knows are email's actual product role, and roughly half of those contacts have an address in Talvia without a synchronized thread. Without first touch, the email channel could execute nothing for them — the participant simply ended as `NOT_ELIGIBLE`, with no explanation a user could act on.

---

## 2026-09 — Grounded generation is channel-parameterized, not duplicated

**Decision**

Email personalization reuses the WhatsApp grounded pipeline rather than getting its own: the same evidence construction from the real conversation, the same segment schema (`generic` / `factual`), the same server-side validation and text reconstruction, the same deterministic fallback. Only the register and the length budget differ.

A participant with no conversation yet (a first touch) has no evidence, so no model call is made at all and the campaign's own template — with the Contact's real fields substituted — is what is proposed for human approval.

Provenance is reported honestly on every channel: an artifact carries `generationMode` (`ai_grounded` or `deterministic_fallback`), and a model name is recorded only when text the model produced actually survived validation. A generation that was produced and then rejected leaves no model name behind.

**Reason**

Two copies of "what may be asserted about a prospect" would drift, and the channel that drifted would be the one nobody re-audited. The grounding rules are a product invariant, not a per-channel implementation detail.
