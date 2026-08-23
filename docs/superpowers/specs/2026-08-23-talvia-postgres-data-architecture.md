# Talvia — architecture de données PostgreSQL

## Portée

Conception pour Neon PostgreSQL uniquement. Aucun accès Neon, `DATABASE_URL`, fichier `.env`, secret, table distante ou migration exécutée n’est inclus dans cette passe.

## Règles transversales

- Toutes les clés primaires sont des `uuid` avec `gen_random_uuid()`.
- Les dates sont des `timestamptz` UTC avec `created_at` et `updated_at` lorsque l’entité évolue.
- Les statuts sont des `varchar` protégés par `CHECK`, afin d’ajouter une valeur par migration sans modifier un type ENUM partagé.
- Les montants sont stockés en unités mineures (`bigint`) et la devise en `char(3)`.
- `metadata` et les configurations variables utilisent `jsonb`; les données métier filtrables restent en colonnes relationnelles.
- Toute donnée commerciale porte `workspace_id`; les accès applicatifs filtrent toujours ce tenant.

## ERD textuel

```text
users 1 ──< workspace_members >── 1 workspaces
workspaces 1 ──< companies 1 ──< contacts
workspaces 1 ──< contacts 1 ──< contact_identities
workspaces 1 ──< connections 1 ──< conversations
contacts 0..1 ──< conversations
conversations 1 ──< conversation_participants >── 0..1 contacts
conversations 1 ──< messages 1 ──< message_attachments

workspaces 1 ──< campaigns 1 ──< campaign_steps
campaigns 1 ──< campaign_participants >── 1 contacts

contacts 1 ──< opportunities
conversations 0..1 ──< opportunities
campaigns 0..1 ──< opportunities
opportunities 1 ──< opportunity_notes
contacts 1 ──< contact_notes

workspaces 1 ──< automations 1 ──< automation_runs
workspaces 1 ──< activities
workspaces 1 ── 1 credit_wallets 1 ──< credit_transactions
workspaces 1 ──< subscriptions >── 1 plans 1 ──< plan_limits
workspaces 1 ──< webhook_events
workspaces 1 ──< ai_usage
```

## Tables et responsabilités

| Table | Responsabilité | Relations principales |
|---|---|---|
| `users` | Identité applicative, sans implémenter l’auth provider | membres, auteur d’activité |
| `workspaces` | Tenant commercial | toutes les données métier |
| `workspace_members` | Appartenance et rôle simple | user, workspace |
| `companies` | Entreprise commune à plusieurs contacts | workspace, contacts |
| `contacts` | Personne commerciale centrale | company, identities, conversations, opportunités |
| `contact_identities` | Email, téléphone, LinkedIn ou futur canal d’un contact | contact, workspace |
| `connections` | Compte connecté du workspace | conversations |
| `conversations` / `messages` | Threads par canal et messages | contact, connection, participants |
| `campaigns` / `campaign_steps` / `campaign_participants` | Séquences et état par contact, sans copie de contact | contacts |
| `opportunities` | Pipeline et prochaine action | contact obligatoire, conversation/campaign optionnelles |
| `contact_notes` / `opportunity_notes` | Notes avec FK réelles, sans relation polymorphe | contact ou opportunité |
| `automations` / `automation_runs` | Règles et exécutions auditables | activités / event source |
| `activities` | Journal transversal et source future de Vue d’ensemble | workspace, acteur, entité |
| `plans` / `plan_limits` / `subscriptions` | Offre et abonnement indépendants du prestataire | workspace |
| `credit_wallets` / `credit_transactions` | Solde calculable et audit de crédits | workspace |
| `webhook_events` | Réception idempotente provider | workspace optionnel après résolution |
| `ai_usage` | Consommation IA sans dépendre d’OpenAI | workspace, user optionnel |

## Colonnes, contraintes et index

### Tenant et identité

| Table | Colonnes essentielles | Contraintes / index |
|---|---|---|
| `users` | `id`, `email`, `first_name`, `last_name`, `avatar_url`, `locale`, `timezone` | `unique(lower(email))`; index `created_at` inutile en V1 |
| `workspaces` | `id`, `name`, `slug`, `owner_user_id`, `default_locale`, `default_timezone` | `unique(slug)`; FK owner `restrict` |
| `workspace_members` | `id`, `workspace_id`, `user_id`, `role`, `status`, `joined_at` | `unique(workspace_id,user_id)`; `role in ('owner','admin','member')`; index `(user_id,workspace_id)` |

### CRM et canaux

| Table | Colonnes essentielles | Contraintes / index |
|---|---|---|
| `companies` | `id`, `workspace_id`, `name`, `domain`, `website_url`, `industry` | `unique(workspace_id, lower(domain)) where domain is not null`; index `(workspace_id,name)` |
| `contacts` | `id`, `workspace_id`, `company_id`, `first_name`, `last_name`, `display_name`, `job_title`, `status`, `archived_at` | FK company `set null`; index `(workspace_id,archived_at,display_name)`; index `(workspace_id,company_id)` |
| `contact_identities` | `id`, `workspace_id`, `contact_id`, `channel_type`, `provider`, `identifier`, `identifier_normalized`, `profile_url`, `metadata` | **`unique(workspace_id, channel_type, identifier_normalized)`**; `identifier_normalized <> ''`; index `(contact_id,channel_type)` |
| `connections` | `id`, `workspace_id`, `provider`, `channel_type`, `external_account_id`, `display_name`, `status`, `connected_at`, `last_synced_at`, `metadata` | `unique(workspace_id,provider,external_account_id)`; index `(workspace_id,status)`; credentials hors de cette table |

`identifier_normalized` est calculé côté application : email en minuscules, téléphone E.164, identifiant LinkedIn stable ou URL canonicalisée. La contrainte empêche donc le même email, numéro ou profil LinkedIn dans un même workspace, tout en permettant une même identité dans deux workspaces distincts.

### Messagerie

| Table | Colonnes essentielles | Contraintes / index |
|---|---|---|
| `conversations` | `id`, `workspace_id`, `connection_id`, `contact_id`, `channel_type`, `external_thread_id`, `subject`, `status`, `last_message_at` | `unique(connection_id,external_thread_id)`; index `(workspace_id,last_message_at desc)`; contact `set null`, connection `restrict` |
| `conversation_participants` | `id`, `conversation_id`, `contact_id`, `external_participant_id`, `role`, `metadata` | `unique(conversation_id,external_participant_id)`; index `(contact_id,conversation_id)` |
| `messages` | `id`, `workspace_id`, `conversation_id`, `provider_message_id`, `direction`, `sender_contact_id`, `body`, `message_type`, `status`, `sent_at`, `received_at`, `metadata` | `unique(conversation_id,provider_message_id) where provider_message_id is not null`; index `(conversation_id,coalesce(sent_at,received_at),id)` |
| `message_attachments` | `id`, `message_id`, `type`, `file_url`, `file_name`, `mime_type`, `size_bytes` | FK message `cascade`; index `(message_id)` |

### Campagnes et opportunités

| Table | Colonnes essentielles | Contraintes / index |
|---|---|---|
| `campaigns` | `id`, `workspace_id`, `name`, `objective`, `channel_type`, `status`, `created_by_user_id`, `settings`, `started_at`, `paused_at`, `completed_at`, `archived_at` | status `draft/active/paused/completed/archived`; index `(workspace_id,status,updated_at desc)` |
| `campaign_steps` | `id`, `campaign_id`, `position`, `step_type`, `channel_type`, `delay_value`, `delay_unit`, `message_template`, `settings` | `unique(campaign_id,position)`; delay non négatif; FK campaign `cascade` |
| `campaign_participants` | `id`, `campaign_id`, `contact_id`, `status`, `current_step_id`, `started_at`, `last_action_at`, `replied_at`, `stopped_at`, `stop_reason` | `unique(campaign_id,contact_id)`; index `(campaign_id,status)`; aucune copie d’identité du contact |
| `opportunities` | `id`, `workspace_id`, `contact_id`, `conversation_id`, `campaign_id`, `name`, `stage`, `status`, `value_minor`, `currency`, `next_action`, `next_action_at`, `lost_reason`, `closed_at` | stage `new/qualified/proposal/negotiation/won/lost`; status `open/won/lost`; index `(workspace_id,status,stage,updated_at desc)`; index partiel `(workspace_id,next_action_at) where status='open' and next_action_at is not null` |
| `opportunity_notes` | `id`, `workspace_id`, `opportunity_id`, `author_user_id`, `body` | index `(opportunity_id,created_at desc)`; FK opportunity `cascade` |
| `contact_notes` | `id`, `workspace_id`, `contact_id`, `author_user_id`, `body` | index `(contact_id,created_at desc)`; FK contact `cascade` |

Une tâche future pourra référencer `workspace_id`, puis exactement un ou plusieurs de `contact_id`, `opportunity_id`, `conversation_id`; aucune colonne existante n’empêche cette addition. Pour la V1, `next_action_at` alimente les relances et Vue d’ensemble.

### Automatisation, activité et intégrations

| Table | Colonnes essentielles | Contraintes / index |
|---|---|---|
| `automations` | `id`, `workspace_id`, `name`, `status`, `trigger_type`, `trigger_config`, `condition_config`, `action_type`, `action_config`, `reply_mode`, `delay_seconds`, `created_by_user_id`, `archived_at` | index `(workspace_id,status)`; `reply_mode in ('draft','auto')`; configs JSONB limitées aux paramètres extensibles |
| `automation_runs` | `id`, `workspace_id`, `automation_id`, `activity_id`, `status`, `started_at`, `completed_at`, `error_message`, `result_summary` | index `(automation_id,created_at desc)`; status `success/skipped/failed` |
| `activities` | `id`, `workspace_id`, `actor_type`, `actor_id`, `event_type`, `entity_type`, `entity_id`, `metadata` | index `(workspace_id,created_at desc)`; index `(workspace_id,entity_type,entity_id,created_at desc)` |
| `webhook_events` | `id`, `workspace_id`, `provider`, `external_event_id`, `event_type`, `payload`, `status`, `processed_at`, `created_at` | `unique(provider,external_event_id)`; index `(status,created_at)`; payload JSONB brut à rétention contrôlée |
| `ai_usage` | `id`, `workspace_id`, `user_id`, `feature`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_minor`, `currency`, `status` | index `(workspace_id,created_at desc)`; aucun prompt complet par défaut |

### Abonnement et crédits

| Table | Colonnes essentielles | Contraintes / index |
|---|---|---|
| `plans` | `id`, `code`, `name`, `description`, `is_active` | `unique(code)`; les prix ne sont pas figés dans le schéma |
| `plan_limits` | `id`, `plan_id`, `limit_key`, `limit_value` | `unique(plan_id,limit_key)`; valeurs pour connexions, IA, campagnes, membres |
| `subscriptions` | `id`, `workspace_id`, `plan_id`, `provider`, `provider_customer_id`, `provider_subscription_id`, `status`, `billing_cycle`, périodes, `cancel_at_period_end` | `unique(provider,provider_subscription_id) where provider_subscription_id is not null`; index `(workspace_id,status)` |
| `credit_wallets` | `id`, `workspace_id`, `balance_minor`, `updated_at` | `unique(workspace_id)`; solde de lecture rapide |
| `credit_transactions` | `id`, `workspace_id`, `wallet_id`, `amount_minor`, `reason`, `reference_type`, `reference_id`, `created_at` | index `(wallet_id,created_at desc)`; immuable; balance reconstruisible par somme |

## Suppressions et isolation

- Supprimer un workspace peut déclencher une purge en cascade contrôlée uniquement depuis une opération administrative explicite.
- Contacts, campagnes et automatisations utilisent `archived_at`; ils ne sont pas détruits lors d’une action utilisateur courante.
- Les enfants intrinsèques (`campaign_steps`, pièces jointes, notes) sont supprimés avec leur parent seulement lors d’une purge réelle.
- Les FKs inter-métier emploient `set null` lorsque l’historique doit survivre (ex. contact d’une conversation), sinon `restrict`.
- Une requête applicative doit toujours porter `workspace_id`; l’ajout futur de RLS est compatible avec ce modèle.

## Correspondance sandbox → base

| Sandbox | Base cible |
|---|---|
| `Contact` | `contacts` + `contact_identities` + `companies` |
| `SandboxConversation` / `SandboxMessage` | `conversations` / `messages` |
| `SandboxCampaign` | `campaigns` + `campaign_steps` + `campaign_participants` |
| `Opportunity` | `opportunities` + `opportunity_notes` |
| `Automation` | `automations` + `automation_runs` |
| `SandboxActivity` | `activities` |

## Étapes suivantes, hors de cette passe

1. Relire et valider ce schéma.
2. Préparer une migration SQL locale cohérente et non exécutée.
3. Créer un seed de développement minimal, non automatique.
4. Choisir Prisma ou Drizzle et remplacer progressivement le store sandbox, module par module.
5. Connecter Neon seulement après validation explicite et configuration sécurisée des variables serveur.
