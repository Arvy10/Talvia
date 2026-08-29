# Talvia — acquisition e-mail opt-in pour la bêta

## Objectif

Permettre à Talvia de capter progressivement des personnes intéressées par la bêta, de leur envoyer une courte séquence e-mail avec consentement, et de conserver leur attribution. Ce système sert l'acquisition de Talvia en tant qu'entreprise ; il ne fait pas partie du CRM des workspaces clients.

## Limites et invariants

- Aucun fichier ou module Inbox, conversations, messages, synchronisation Unipile, LinkedIn, WhatsApp, Gmail provider ou webhook Unipile ne sera modifié.
- Aucun scraping ni cold email : seules les personnes inscrites ou importées avec consentement explicite sont contactées.
- `contacts`, `contact_identities`, campagnes et automations restent réservés au cycle commercial des clients Talvia.
- PostgreSQL/Neon est la source de vérité. Resend est uniquement un adaptateur de délivrance.
- Les secrets restent côté serveur ; aucun identifiant Resend n'est exposé au navigateur.
- Aucun dashboard, CRM acquisition, système de scoring, Stripe ou plateforme de marketing n'est inclus dans ce lot.

## Modèle de données

Une migration additive crée trois tables globales, sans `workspace_id` :

### `beta_leads`

Identifie une personne intéressée par Talvia avec :

- `id` UUID ;
- `email` et `email_normalized` ;
- `first_name` et `role` facultatifs ;
- `source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `landing_url` facultatifs ;
- `status` : `WAITLIST`, `INVITED`, `ACTIVATED`, `CUSTOMER` ou `UNSUBSCRIBED` ;
- `consent_at`, `unsubscribed_at`, `created_at`, `updated_at`.

`email_normalized` est produit par le serveur avec `trim().toLowerCase()`. Un index unique garantit l'unicité indépendamment de la casse. Le serveur ne modifie pas les champs d'attribution ni le consentement d'un lead déjà présent.

### `acquisition_email_deliveries`

File d'envoi et journal idempotent : `lead_id`, `email_type`, `scheduled_at`, `sent_at`, `status`, `attempt_count`, `provider_message_id`, `last_error`, horodatages. Une contrainte unique `(lead_id, email_type)` empêche deux envois du même jalon à un lead.

Les types initiaux sont `welcome`, `day_1`, `day_3` et `beta_access`. Les états de livraison sont limités à `pending`, `sending`, `sent`, `failed`, `skipped` et `cancelled`.

### `acquisition_email_events`

Journal compact des événements Resend utiles : type de l'événement, identifiant fournisseur éventuel, données utiles minimales, date de réception et clé d'idempotence. Les événements se rattachent à une livraison par `provider_message_id` quand il est disponible.

## Inscription et attribution

La page publique `/beta` propose uniquement prénom, e-mail et activité/rôle facultatif. Elle lit les paramètres UTM de l'URL côté client et les envoie avec l'URL de landing au point d'entrée public.

Le point d'entrée valide puis normalise l'e-mail côté serveur. Une nouvelle inscription crée un `beta_lead` en `WAITLIST`, enregistre le consentement et crée les livraisons bienvenue immédiate, J+1 et J+3 dans la même transaction. Une adresse déjà enregistrée répond par une confirmation neutre et ne crée aucune nouvelle ligne ni nouvel envoi.

Un message de confirmation est affiché immédiatement, sans révéler d'information au-delà du fait que l'inscription est enregistrée.

## E-mail et désinscription

Un module serveur `resend` encapsule l'API HTTP de Resend. L'expéditeur, l'adresse de réponse, la clé API et l'URL applicative viennent des variables d'environnement. Les e-mails d'authentification existants continuent à utiliser Brevo ; cette intégration ne les modifie pas.

Le premier e-mail de bienvenue est un HTML léger et responsive. Chaque e-mail marketing inclut un lien de désinscription signé, à durée longue mais vérifiable. Ce lien marque le lead `UNSUBSCRIBED`, renseigne `unsubscribed_at`, et annule ses livraisons en attente. L'action est idempotente.

## Séquence et scheduler

Le scheduler est un endpoint interne protégé par `ACQUISITION_SCHEDULER_SECRET`, appelable par le cron de l'hébergeur. À chaque exécution, il réclame atomiquement un petit lot de livraisons dues ; l'exécution concurrente ne peut pas réclamer la même livraison.

Avant l'appel à Resend, il vérifie que le lead n'est pas désinscrit et que son statut permet ce type d'envoi. Après l'appel, il journalise le résultat et l'identifiant fournisseur. Les échecs restent rejouables de manière bornée ; un envoi marqué `sent` ne repart jamais. L'accès bêta est envoyé uniquement à un lead devenu `INVITED` par une action explicite ultérieure ; le mécanisme est préparé mais pas d'interface d'invitation dans ce lot.

## Webhook Resend

`/api/webhooks/resend` vérifie la signature Resend avec `RESEND_WEBHOOK_SECRET`, refuse les requêtes non authentifiées et déduplique les événements par leur identifiant. Il enregistre les événements utiles de livraison/échec et met à jour la livraison correspondante sans produire de dashboard analytique.

## Environnement

Ajouter à `.env.example` :

- `RESEND_API_KEY`
- `RESEND_EMAIL_FROM`
- `RESEND_EMAIL_REPLY_TO`
- `APP_URL`
- `ACQUISITION_SCHEDULER_SECRET`
- `RESEND_WEBHOOK_SECRET`
- `ACQUISITION_UNSUBSCRIBE_SECRET`

## Tests et validation

Les tests couvrent : inscription valide, invalidité, normalisation/doublon, attribution UTM, désinscription, planification idempotente, double exécution du scheduler, échec Resend et webhook dédupliqué/signé. Les tests précèdent le code concerné. La validation finale exécute tests, lint, vérification TypeScript et build.

## Hors périmètre

- interface d'administration des leads ;
- import CSV effectif (le schéma le rendra possible ultérieurement) ;
- invitation manuelle et conversion automatique vers utilisateur/client ;
- analytique avancée ;
- mailing de masse, scoring, segments ou automatisations marketing.
