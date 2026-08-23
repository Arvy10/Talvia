# Talvia — Automatisations sandbox

## Objectif

Faire d’Automatisations une interface commerciale simple : une règle lit un événement sandbox, applique au plus une condition, puis exécute une action locale traçable. Talvia n’expose ni webhooks, ni nœuds, ni APIs.

## Modèle et moteur unique

`Automation` est enrichie avec un événement, une condition facultative, une action, un statut, les réglages de réponse future et des dates. Un seul moteur pur reçoit chaque événement à la suite des mutations Inbox, Campagnes, Contacts ou Opportunités. Il détermine les règles actives applicables, produit les mutations sandbox et enregistre le résultat dans la liste d’activités globale. Le bouton « Exécuter un test » construit un événement sandbox et appelle exactement ce moteur : il ne possède aucune logique propre.

Les résultats d’exécution sont `success`, `skipped` ou `failed`. Les actions V1 exécutables sont : arrêter une séquence de campagne, créer une prochaine action sur une opportunité, marquer une conversation à traiter et préparer un brouillon local. Les données restent locales et ne contactent aucun fournisseur.

## Interface

La page comporte deux onglets : Mes automatisations et Templates. Les règles créées apparaissent dans une liste dense : phrase `Quand → Alors`, statut, canal, dernière exécution et actions activer, modifier, dupliquer, supprimer. Une fiche latérale légère contient les détails, l’activité filtrée et « Exécuter un test » comme outil secondaire sandbox.

Le formulaire utilise les mots utilisateur : Quand, Si, Alors. Il propose des événements et actions V1 limités, un canal, une condition simple et des paramètres utiles à l’action. Les templates préremplissent ce formulaire sans créer de règle tant que l’utilisateur ne l’enregistre pas.

## Réponse future

Le modèle prépare `replyMode: draft | auto`, canaux autorisés et délai. Le brouillon est le défaut. Le choix auto exige une confirmation explicite et affiche « Simulation uniquement — aucun message réel ne sera envoyé ». En V1, même ce mode ne crée aucun message sortant : il peut seulement produire un résultat d’activité sandbox.

## Intégrations

Inbox transmet les événements de messages entrants et de réponses ; Opportunités transmet les changements d’étape ; Campagnes et Contacts transmettent leurs mutations pertinentes. Ces appels transportent des identifiants et des métadonnées minimales, sans dupliquer de contact ou de conversation. Les modifications des autres interfaces se limitent à déclencher ce moteur commun.

## Validation

Les tests couvrent le moteur, règles inactives, arrêt de campagne, proposition vers prochaine action, message à traiter, exécution via bouton test, persistance, édition, duplication et suppression. La livraison exige lint ciblé, tests complets, build, puis vérification visuelle desktop et mobile.
