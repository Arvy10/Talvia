# Talvia — état de développement

Les modules Contacts, Opportunités, Campagnes et Inbox ont une source de vérité PostgreSQL/Neon.

La migration `006_automations_persistence.sql` est appliquée sur Neon. Elle ajoute l’infrastructure Automatisations : activités avec origine, idempotence des runs, statuts persistants et marquage `to_process` des conversations. Le moteur et les routes Automatisations sont présents ; l’Inbox entrant, les Opportunités et la création de Campagne utilisent le dispatch post-commit.

La migration complète de l’interface Automatisations vers Neon et la suite `test:automations:validation` restent à terminer. L’interface Automatisations actuelle reste sandbox : elle ne doit pas être présentée comme persistante tant que ce raccordement n’est pas fait.

Pour reprendre le projet : installer les dépendances, configurer les variables locales (`DATABASE_URL`, Better Auth), appliquer les migrations versionnées à Neon et lancer `npm run dev`.
