# Talvia — Restructuration de la section Opportunités

## Objectif

Transformer `/app/opportunities` en pipeline commercial léger, opérationnel et relié aux données sandbox existantes. L’utilisateur doit identifier rapidement les ventes possibles, leur étape, la prochaine action et les opportunités qui stagnent, sans transformer Talvia en CRM complexe.

## Périmètre

La passe concerne principalement Opportunités. Les modifications hors de ce module sont limitées aux extensions nécessaires du modèle sandbox et aux relations existantes avec Contacts, Inbox et Campagnes. Aucun service externe, score IA, reporting avancé ou nouveau design system ne sera ajouté.

## Direction visuelle

L’interface conserve les couleurs et composants Talvia : fond sombre aubergine, surfaces légèrement vitrées, violet et corail utilisés comme accents discrets, texte clair et densité professionnelle. Le pipeline constitue la signature visuelle : une ligne de progression lisible, des colonnes compactes et des cartes sobres plutôt que de grosses surfaces décoratives.

## Structure de la page

Le header reste compact avec le titre « Opportunités », la description validée et l’action « Nouvelle opportunité ». Une barre fonctionnelle regroupe la recherche, les filtres canal/état et le toggle `Pipeline | Liste`.

La vue principale présente cinq colonnes : Nouveau, Qualifié, Proposition, Négociation et Gagné. Les opportunités perdues sont retirées de la vue ouverte et accessibles avec le filtre Perdu. Sur tablette, le pipeline utilise un défilement horizontal contrôlé. Sur mobile, un sélecteur d’étape remplace le Kanban horizontal et affiche la liste compacte de l’étape choisie.

## Cartes et liste

Une carte affiche uniquement : titre, contact, entreprise, valeur lorsqu’elle existe, canal/source, prochaine action et dernière activité. Une indication « À relancer » ou « Inactif depuis X jours » repose exclusivement sur la date réelle de dernière activité.

La vue Liste reprend les mêmes informations dans un tableau dense : opportunité, contact, entreprise, étape, valeur, prochaine action et dernière activité.

## Déplacement dans le pipeline

Le déplacement entre colonnes utilise les événements natifs du navigateur afin d’éviter une nouvelle dépendance. Le changement est immédiatement envoyé au reducer puis persisté par le système sandbox actuel. La fiche contient également un sélecteur d’étape accessible au clavier et aux technologies d’assistance.

## Création et modification

Le formulaire utilise un modal cohérent avec Talvia. Le contact existant est obligatoire. Les champs sont : nom, contact, étape, valeur facultative, devise `USD | EUR | XAF`, prochaine action, date et notes.

Le modèle conserve des références, jamais des copies : `contactId`, `conversationId` et `campaignId` lorsque disponibles. Un même contact peut posséder plusieurs opportunités. Si une opportunité ouverte existe déjà pour le contact, le formulaire affiche un avertissement avec les actions « Voir l’opportunité » et « Créer quand même », sans bloquer la création.

## Fiche dans un drawer

Cliquer sur une carte ouvre un drawer contextuel d’environ 780 px. Le pipeline reste visible sous un voile sombre. Sur mobile, le drawer devient une vue plein écran.

Le drawer contient :

- un header avec titre, contact, entreprise, étape, valeur et actions ;
- un bloc Contact avec lien vers la fiche existante ;
- la prochaine action, sa date, sa modification et son marquage comme terminée ;
- les conversations liées avec ouverture dans Inbox ;
- une action Contacter proposant seulement les canaux disponibles ;
- la source et la campagne liée, si elles existent ;
- des notes persistantes ;
- une timeline compacte composée uniquement d’événements réellement enregistrés.

## Gagné et Perdu

Le passage à Gagné ouvre une confirmation légère et permet facultativement de renseigner la valeur finale et la date de clôture. Le passage à Perdu propose une raison facultative parmi Prix, Pas de besoin, Pas maintenant, Concurrent, Pas de réponse et Autre. Une opportunité perdue n’est jamais supprimée.

## Modèle sandbox

`Opportunity` est enrichi avec les propriétés facultatives nécessaires : valeur, devise, prochaine action, date, notes, source, conversation, campagne, dates de création/mise à jour/clôture, valeur finale, raison de perte et historique d’activité.

Le reducer reçoit des actions de mise à jour complète de l’opportunité et d’ajout d’activité. La validation du stockage accepte l’ancien modèle afin de préserver les données existantes, tout en validant les nouveaux champs. Aucune migration destructrice n’est nécessaire.

## Relations

Contacts continue d’afficher toutes les opportunités reliées par `contactId`. Inbox et Contacts peuvent créer une opportunité préremplie via un contexte local ou des paramètres d’URL légers ; aucune copie de contact n’est créée. La campagne et la conversation sont conservées lorsqu’elles sont connues. Cette passe ne restructure pas les interfaces de ces modules.

## États et erreurs

Sans contact existant, la création explique qu’un contact est requis et renvoie vers Contacts. Les champs obligatoires affichent une erreur près du champ concerné. Les états vides reprennent le texte du brief. Une action impossible ne fabrique jamais de donnée fictive.

## Tests et validation

Les tests couvrent au minimum : création et persistance, déplacement par glisser-déposer et sélecteur, multi-opportunités pour un contact, affichage dans Contacts, passage Gagné, passage Perdu avec conservation, prochaine action terminée et ouverture du drawer.

La validation finale comprend lint ciblé, typecheck/build, suite de tests, puis contrôle visuel desktop, tablette et mobile. Les erreurs antérieures hors périmètre sont distinguées des régressions introduites.

