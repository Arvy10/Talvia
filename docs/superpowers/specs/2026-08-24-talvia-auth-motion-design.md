# Talvia — animation de connexion et d’inscription

## Objectif

Refondre uniquement la présentation des pages `/login` et `/signup` afin de reprendre le mouvement d’un panneau incurvé qui traverse une carte d’authentification. Les formulaires e-mail, la vérification d’e-mail et le comportement Better Auth existants restent inchangés.

## Direction visuelle

- Toutes les couleurs proviennent des variables et styles Talvia déjà en place.
- Aucun violet, bleu, framboise, vert ou autre couleur de la référence n’est repris.
- Le logo, les libellés, les textes, les bordures et les états de champ restent Talvia.
- La référence ne sert qu’à la géométrie du panneau et à son animation.

## Interaction

- La page est une carte d’authentification à deux zones sur écran large.
- Un panneau Talvia avec une frontière incurvée occupe alternativement le côté gauche ou droit.
- Cliquer sur « Créer un compte » ou « Se connecter » déclenche un glissement court du panneau vers l’autre côté, puis la navigation vers `/signup` ou `/login`.
- Une arrivée directe sur une URL affiche immédiatement le bon état, sans dépendre de l’animation précédente.
- Les boutons de formulaire conservent la soumission réelle actuelle ; l’animation de bascule ne soumet jamais un formulaire.

## Responsive et accessibilité

- Sous la largeur tablette, le panneau décoratif est retiré au profit d’un formulaire Talvia simple et lisible.
- `prefers-reduced-motion` retire le glissement et garde une navigation immédiate.
- Les contrôles restent des liens/boutons sémantiques, accessibles au clavier, avec focus visible.

## Hors périmètre

- Aucun fournisseur social fictif.
- Aucune modification de Better Auth, des routes API, de Neon ou du flux de confirmation d’e-mail.
