# Owlog

PWA mobile-first de suivi de contenus médias. Films et séries au lancement, extensible aux animes, livres, audiobooks et musique. Interface en français.

**Objectif produit central : ajouter un contenu avec le moins de clics possible.**

## Ce qui distingue Owlog

**Le visionnage est l'unité d'enregistrement, pas le film.**

Les autres trackers modélisent le film. Le revisionnage y devient une métadonnée : un booléen chez Letterboxd, un compteur chez Yamtrack. En modélisant le visionnage, il devient un objet de première classe, avec sa propre date, sa propre note et son propre commentaire. Trois conséquences que le marché ne peut pas copier sans refaire son modèle :

- **La note par cycle.** `★3 en 2019 → ★5 en 2027`. L'évolution du goût, mesurée.
- **Le journal comme structure.** Les marqueurs `— visionnage #N —` sont la projection directe du store d'événements, pas un affichage.
- **L'export lisible et réimportable.** Un fichier `.log` qu'on lit à l'œil nu et qu'on recharge.

Techniquement : un store d'événements append-only est la source de vérité, tout le reste est calculé.

## Démarrer

```bash
corepack enable pnpm
pnpm install
pnpm dev
```

Node 22 ou plus, et le CLI Doppler — les secrets du projet y vivent, `pnpm dev` l'appelle lui-même. La commande démarre l'API **et** le web : l'application se sert sur `http://localhost:5173`, l'API est relayée sous `/api` par le serveur de dév, comme en production.

Sans base de données locale, `/auth` et `/sync` répondent 503 : la synchronisation multi-appareils ne se teste pas en local, tout le reste fonctionne — l'application est locale d'abord.

```bash
pnpm build     # construction de production
pnpm test      # tests unitaires (Vitest)
pnpm lint      # ESLint
```

## Structure

```
apps/web/                 PWA React + TypeScript
  src/
    ports/                interfaces : EventStore, Outbox, SyncGateway,
                          AuthGateway, MediaCatalog…
    adapters/             implémentations : dexie, sync, sync-http,
                          auth-http, tmdb-http, browser
    ui/                   écrans React + Tailwind
apps/api/                 service Hono — proxy TMDB, auth par lien magique
                          + code court, réplication /sync sur Postgres
packages/domain/          le domaine : règles, commandes, réducteurs. Zéro
                          infrastructure ; consommé par le web et par l'API
  src/
    commands/             construction d'événements
    reducers/             projections (statut, journal, bibliothèque…)
    rules/                rang des cycles, dérivation du statut
    ports/                Clock, IdGenerator — les ports que le domaine
                          consomme lui-même
packages/contracts/       contrat partagé entre les deux (formes + Zod)
docs/                     documentation : déploiement, checklist, design system
```

L'architecture est hexagonale : le domaine ne connaît ni Dexie ni le réseau. C'est ce qui rendra le passage à Postgres un remplacement d'adaptateur plutôt qu'une réécriture.

## Documents

| Fichier | Contenu |
|---|---|
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Convention de branches et de commits. **À lire d'abord pour comprendre l'historique.** |
| [CLAUDE.md](CLAUDE.md) | Règles projet et stack, formulées pour un assistant de code |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | Six vérifications sur téléphone réel avant chaque mise en ligne |
| `docs/design_handoff_owlog/README.md` | Spécification des écrans, tokens, composants |

Le document de design complet — modèle de données, règles de dérivation, onze étapes de construction, critères de réussite — vit hors du dépôt. L'original a été perdu ; la **reconstitution du 2026-07-30 fait foi** : `~/.gstack/projects/owlog-app/tx-dev-design-20260730-reconstitue.md`. Le plan du sprint temps 2 (audit trail de 38 décisions) : `~/.gstack/projects/t3hx-owlog-app/tehx-dev-sprint-temps2-plan-20260730.md`.

## État

**Temps 1 : les onze étapes sont livrées et en ligne** — socle, domaine, proxy TMDB, PWA installable, recherche et ajout en un tap, export/import `.log`, rétro-datage, revisionnages, bibliothèque, stats, LOG global.

**Temps 2 en cours** : comptes optionnels et synchronisation multi-appareils. Livré sur `dev` : Postgres + migrations sous advisory lock + sauvegarde chiffrée (F2), auth par lien magique + code court (F3), réplication `/sync` à curseurs sérialisés (F4), SyncEngine client à outbox transactionnelle (F5), écrans Landing / Connexion / Réglages (F6). En cours : consolidation et mise en ligne (F7). Le compte reste optionnel : sans session, l'app est exactement le temps 1.

Plus de 450 tests (Vitest), CI GitHub Actions sur chaque poussée — lint, build, et tests d'intégration contre un Postgres jetable dont chaque base est vierge : les migrations sont rejouées à chaque exécution.

`git log --first-parent --oneline dev` donne l'avancement étape par étape.

`main` n'est pas la branche de travail : elle porte l'état exact de ce qui est déployé, et ne reçoit `dev` qu'au moment d'une mise en ligne. Voir [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

<!-- test pipeline -->
