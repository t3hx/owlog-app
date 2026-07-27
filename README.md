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

Node 22 ou plus. L'application se sert sur `http://localhost:5173`.

```bash
pnpm build     # construction de production
pnpm test      # tests unitaires (Vitest)
pnpm lint      # ESLint
```

## Structure

```
apps/web/                 PWA React + TypeScript
  src/
    domain/               règles, commandes, réducteurs. Zéro infrastructure.
      commands/           construction d'événements
      reducers/           projections (statut, journal, bibliothèque…)
      rules/              rang des cycles, dérivation du statut
    ports/                interfaces : EventStore, MediaCatalog, Clock, IdGenerator
    adapters/             implémentations : dexie, tmdb-http, browser
    ui/                   écrans React + Tailwind
design_handoff_owlog/     design system verrouillé et prototypes hifi
```

L'architecture est hexagonale : le domaine ne connaît ni Dexie ni le réseau. C'est ce qui rendra le passage à Postgres un remplacement d'adaptateur plutôt qu'une réécriture.

## Documents

| Fichier | Contenu |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Convention de branches et de commits. **À lire d'abord pour comprendre l'historique.** |
| [CLAUDE.md](CLAUDE.md) | Règles projet et stack, formulées pour un assistant de code |
| [CHECKLIST.md](CHECKLIST.md) | Six vérifications sur téléphone réel avant chaque mise en ligne |
| `design_handoff_owlog/README.md` | Spécification des écrans, tokens, composants |

Le document de design complet — modèle de données, règles de dérivation, onze étapes de construction, critères de réussite — vit hors du dépôt, dans `~/.gstack/projects/owlog-app/`.

## État

Étape 1 sur 11 livrée : socle, tokens, polices, état vide. En cours : étape 2, le domaine.

`git log --first-parent --oneline dev` donne l'avancement étape par étape.
