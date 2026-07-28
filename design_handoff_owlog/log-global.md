# LOG global — spécification d'écran

Écran hors handoff, étape 9. Le document de design impose une session de design avant la session de code ; ceci en est le rendu. Pas de prototype : c'est le moins dessiné des quatre écrans restants, et c'est voulu.

Le système de design ne bouge pas : tokens, typo et composants sont ceux du handoff. Rien ici ne rediscute le verrou.

## Ce que l'écran doit réussir

**Rendre la thèse visible.** Le visionnage est l'unité d'enregistrement, pas le film — et jusqu'ici cette idée n'existe qu'en bas de la page média, un titre à la fois. Le LOG global est le seul endroit où l'on voit une vie de spectateur défiler.

Le critère d'acceptation est littéral : **le flux montre la même chose que l'export `.log`, en plus lisible.** Un écart entre les deux est un défaut, pas une liberté d'affichage.

## Six décisions, et pourquoi

**Un flux plat, pas de sections.** Ni regroupement par jour, ni marqueurs `— visionnage #N —`. Le marqueur de cycle a du sens sur une fiche, où les cycles d'un titre se suivent ; noyé dans tous médias confondus il numéroterait des choses sans rapport les unes sous les autres. Chaque ligne porte sa date, ce qui suffit.

**`PROG` exclu, comme dans le journal et dans le corps de l'export.** Personne ne veut relire qu'il a poussé une barre à 30 % un mardi. La progression reste visible là où elle sert — la barre de l'accueil — et reste sauvegardée là où elle compte, dans la section de queue du `.log`. C'est la même règle qu'ailleurs, appliquée au même endroit du code.

**Lecture seule. Pas d'appui long pour annuler.** L'annulation vit sur la fiche, où l'on voit le cycle auquel l'entrée appartient et ce que l'annuler va faire au statut. Ici on ne voit qu'une ligne parmi mille : annuler à l'aveugle dans un flux est le geste le plus regrettable qu'on puisse offrir sur un journal.

**Pagination explicite, pas de défilement infini.** Un bouton `charger plus` en pied de liste. Le défilement infini demande un observateur d'intersection et rend la fin du flux inatteignable — or la fin du flux, sur ce produit, c'est le premier titre jamais logué, et c'est précisément ce qu'on veut pouvoir atteindre.

**Chaque ligne porte son titre, jamais une référence nue.** Quand le cache ne connaît pas le titre — cas réel après une restauration depuis un `.log`, qui rejoue les événements et pas le cache TMDB — la ligne affiche `titre à recharger` et reste cliquable. Ouvrir la fiche appelle `/media/:ref` et répare le cache. Sauter la ligne ferait un flux qui ment par omission.

**Le port gagne une lecture descendante.** `eventsSince(cursor, limit)` pagine par identifiant **croissant** : il sert l'export et la synchronisation, qui partent du début. Un flux se lit du plus récent au plus ancien, et le servir avec une pagination croissante obligerait à tirer toute la table pour en afficher les vingt dernières lignes — c'est-à-dire le vidage que le port interdit explicitement. D'où `eventsRecent(before, limit)`, qui se traduit côté Postgres par `WHERE id < $1 ORDER BY id DESC LIMIT $2`, une requête indexée.

## Composition

| Bloc | Contenu | Règle |
|---|---|---|
| En-tête | `LOG` Chakra Petch 25px, sous-ligne mono `› N entrées` | pas de barre de recherche : ce n'est pas un écran d'ajout |
| Ligne | `2026-07-28 · vu · Severance` en mono 10.5px, `border-left #212A3D` | date en `subtle`, verbe coloré par type, titre en `text` |
| Repli | `charger plus` en mono 10px, centré | disparaît quand le flux est épuisé |
| Vide | `ton log est vide` + une phrase | même ton que les autres états vides |

Les couleurs de verbe sont celles du journal de la fiche, sans exception : `à voir` jaune, `commencé` et `revisionnage` menthe, `vu` bleu, `abandonné` et `retiré` rouge, le reste en `muted`.

## Domaine et DRY

Trois choses existent déjà et ne seront pas réécrites :

- **`applyVoids` en tête de chaîne**, comme partout ailleurs ;
- **l'exclusion de `PROG`**, aujourd'hui une constante privée de `reducers/journal.ts` — elle en sort pour être partagée ;
- **l'ordre chronologique décroissant à dates inconnues en queue**, aujourd'hui privé lui aussi. Une seconde implémentation divergerait en silence, et l'écart ne se verrait que sur des rétro-datages à l'année, c'est-à-dire tard.

Le nouveau réducteur `log(events)` rend une liste plate d'entrées datées. Il ne groupe rien : c'est ce qui le distingue de `journal(events)`, et c'est la responsabilité unique de chacun.

Le rendu d'une ligne — date, verbe, couleur — sort de `screens/Media.tsx` vers un composant partagé. Deux écrans qui affichent le même événement ne peuvent pas le nommer différemment.
