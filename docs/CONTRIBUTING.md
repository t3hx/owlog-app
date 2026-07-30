# Comment ce dépôt est organisé

Ce document existe pour qu'une personne qui découvre le projet puisse comprendre le travail réalisé en lisant `git log`, sans avoir à lire le code.

## Le plan

Le travail suit un document de design en onze étapes, écrit avant la première ligne de code et passé par une revue d'ingénierie :

`~/.gstack/projects/owlog-app/tx-dev-design-*.md`

Ce document contient le modèle de données, les règles de dérivation, l'ordre de construction, les critères de réussite et les questions restées ouvertes. **Il est la référence.** Le code l'applique, il ne le redéfinit pas.

## Branches

| Branche | Rôle |
|---|---|
| `main` | **Ce qui est en ligne.** Seule branche déployée. |
| `dev` | Intégration. Chaque étape du plan y est fusionnée. Branche par défaut du dépôt. |
| `feat/NN-nom` | Une branche par étape du plan. `NN` est le numéro de l'étape. |

**`main` ne suit pas `dev`.** Elle reste volontairement en retrait et ne reçoit `dev` qu'au moment d'un déploiement. Ce n'est pas une branche d'archivage, c'est l'état exact de ce qui tourne sur le VPS : `git log main` répond à la question « qu'est-ce qui est en ligne, là, maintenant ? », et une branche qui avance à chaque étape ne pourrait pas y répondre.

Premier passage prévu : le déploiement de test de l'étape 3.

La branche par défaut du dépôt est donc `dev`, pas `main` — c'est là que le travail se lit.

Une branche par étape, et une seule. `feat/01-socle`, `feat/02-domaine`, `feat/03-proxy-pwa`, et ainsi de suite jusqu'à `feat/11-stats`.

**Fusion en `--no-ff`**, toujours. Le commit de fusion est ce qui rend l'historique lisible :

```
$ git log --first-parent --oneline dev

  Merge: etape 02 — domaine complet
  Merge: etape 01 — socle, tokens, polices, etat vide
  feat(docs) : ajouts prototypes html pour implementation de l'UI
```

`git log --first-parent dev` est la table des matières du plan. Pour le détail d'une étape, `git log feat/01-socle`.

## Commits

Messages en **français**, à l'impératif, préfixés par un type et une portée :

```
type(portee) : description
```

| Type | Usage |
|---|---|
| `feat` | Nouvelle capacité |
| `fix` | Correction d'un comportement faux |
| `test` | Ajout ou modification de tests seuls |
| `refactor` | Réorganisation sans changement de comportement |
| `docs` | Documentation |
| `chore` | Outillage, configuration, dépendances |

Portées utilisées : `domain`, `adapters`, `api`, `ui`, `pwa`, `design`, `setup`, `projet`.

**Jamais de co-auteur.** Aucun `Co-Authored-By`, aucune mention d'outil ou d'assistant dans un message de commit.

### Branches hors étapes

Le travail transversal, qui ne correspond à aucune étape du plan, prend un préfixe qui dit sa nature plutôt qu'un numéro : `refactor/…` pour une réorganisation sans changement de comportement, `chore/…` pour de l'outillage, `fix/…` pour une correction. Même règle de fusion en `--no-ff`.

`git log --first-parent dev` reste lisible : les fusions d'étapes portent un numéro, les autres portent leur nature.

### Langue

Les messages de commit sont en français. **Le code est en anglais**, sans exception — voir `CLAUDE.md`. Les noms de tests restent en français : ce sont des phrases descriptives, pas des identifiants.

## Développement piloté par les tests

Sur `domain/`, le test précède le code, et **les deux sont des commits distincts** :

```
  test(domain) : derivation du statut par rang de cycle (rouge)
  feat(domain) : rules/status + diagramme ASCII
```

Le premier commit ajoute un test qui échoue. Le second le fait passer. Un lecteur voit ce qui était attendu avant de voir comment ça a été résolu, et la discipline est vérifiable dans l'historique plutôt qu'affirmée dans un document.

Cette règle s'applique à `domain/commands/`, `domain/reducers/`, `domain/rules/` et aux adaptateurs. Elle ne s'applique pas à l'UI, dont le contrôle est la comparaison visuelle à 375px avec les prototypes de `design_handoff_owlog/`.

## Ce qu'un commit ne contient jamais

- du code commenté, un bloc désactivé, un `TODO` orphelin ;
- un diagramme ASCII périmé — les mettre à jour fait partie de la modification qui les invalide ;
- une valeur Tailwind arbitraire sur un token (`bg-[#121724]`) : les tokens du handoff **sont** le thème.

## Avant chaque mise en ligne

`docs/CHECKLIST.md` — six vérifications sur téléphone réel que le navigateur piloté simule mal. Chaque item indique l'étape à partir de laquelle il s'applique.

## Les règles pour un agent

`CLAUDE.md` — mêmes règles, formulées pour un assistant de code, plus la stack et les pièges connus.
