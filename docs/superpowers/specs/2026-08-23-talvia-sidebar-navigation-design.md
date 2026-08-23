# Refonte de la navigation latérale Talvia

## Objectif

Rendre la navigation Talvia plus compacte, hiérarchisée et utilisable sur tous les écrans sans modifier l'identité visuelle, l'ordre fonctionnel ni les destinations existantes.

## Comportement

- La marque Talvia en tête devient une commande unique : l'icône des nœuds reliés réduit ou agrandit la barre sur écran large.
- Réduite, la navigation reste présente sous forme d'icônes, avec des libellés accessibles au survol et au clavier.
- Sur mobile, le même contrôle ouvre un panneau latéral modal ; Échap, clic hors panneau et navigation ferment ce panneau.
- Le bouton « Réduire » existant et le bouton menu/hamburger de la topbar sont supprimés.
- « Aujourd'hui » devient « Vue d'ensemble » tout en conservant la route `/app`.

## Hiérarchie visuelle

- Les liens restent dans l'ordre Talvia actuel : Vue d'ensemble, Inbox, Campagnes, Opportunités, Contacts, Automatisations, Connexions, Paramètres.
- Des libellés de groupes légers et des séparateurs structurent les liens sans introduire de nouvelles destinations.
- Le lien actif conserve le langage visuel Talvia, avec une surface discrète, un repère latéral et un état de focus clavier visible.
- Le pied de barre conserve le menu utilisateur sandbox.

## Contraintes et validation

- Aucun changement de route ou de stockage utilisateur.
- La préférence de barre réduite est conservée en localStorage.
- Aucun contrôle ne doit être inaccessible sur clavier ou mobile.
- La topbar reste lisible après le retrait du hamburger.

## Fichiers ciblés

- `app/app/components/Sidebar.tsx`
- `app/app/components/AppShell.tsx`
- `app/app/components/Topbar.tsx`
- `app/app/components/navigation.ts`
- `app/app/v2.css`
