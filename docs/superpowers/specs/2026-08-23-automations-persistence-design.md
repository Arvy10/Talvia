# Talvia Automatisations — Design

## Goal

Make Neon/PostgreSQL the only business-data source for Automatisations while preserving the existing builder and sandbox-only test experience.

## Data model

Migration `006_automations_persistence.sql` upgrades the existing `automations` and `automation_runs` tables instead of introducing parallel tables. Automations use `active`, `inactive`, and `archived`; flexible rule details remain in JSONB configs. Runs retain the triggering `activity_id` and have a partial unique index on `(automation_id, activity_id)` when the activity is non-null.

Activities gain `source` (`user`, `automation`, `test`) and nullable `automation_run_id`. This is the loop guard: `processActivity` never processes activities whose source is `automation`.

## Event flow

Each domain service records an activity through a common activity helper. After the primary mutation commits, it invokes `processActivity(activity)` in a protected best-effort call. The engine loads active automations scoped to the activity workspace, evaluates simple flat conditions, creates an idempotent run, performs its action via the existing domain service, then closes the run as `success`, `skipped`, or `failed`.

The caller catches engine errors; the original Contact, Opportunity, Campaign, or Inbox operation remains successful. A failed action becomes a persisted failed run without leaking database errors.

## Actions and safety

Supported V1 actions are stop campaign participant, create opportunity, update opportunity stage, create next action, update contact status, add contact note, mark conversation to-process, and create reply draft. Every ID used from activity metadata or `action_config` is resolved with the current workspace context, so cross-workspace resources cannot be changed. Reply `auto` stays a local simulation: no provider/API call and no sent message.

## UI and API

`AutomationsClient` loads the list and run history from `/api/automations`. It keeps only selection, filters and dialog/form state locally. Templates create real persisted automations. The manual test endpoint creates a test activity and calls the same engine. Archive replaces deletion; duplicate produces a new inactive rule and no copied runs.

## Validation

`scripts/validate-automations.mjs` writes each scenario to ignored `validation/automations-validation.json`. It covers persistence, active/inactive runs, real Inbox/Opportunity/Campaign actions, idempotence, archive/duplicate, failures, and workspace isolation.
