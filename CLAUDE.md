# Owlog

PWA mobile-first de suivi de contenus médias (films et séries au lancement, extensible animes, livres, audiobooks, musique). Interface en **français**. Ambiance nocturne épurée, cyberpunk sobre, dimension « log informatique » subtile.

Objectif produit central : **ajouter un contenu avec le moins de clics possible**.

Thèse produit : **le visionnage est l'unité d'enregistrement, pas le film.** Un store d'événements append-only est la source de vérité ; statut, progression, `✓ vu ×N`, journal et statistiques sont des projections calculées, jamais stockées.

## Documents de référence

- `design_handoff_owlog/README.md` — spécification des 9 écrans, tokens, composants, règles ♥ et revisionnage. **Le design est verrouillé, il ne se rediscute pas.**
- `design_handoff_owlog/design-system.md` — résumé des tokens et règles.
- `design_handoff_owlog/*.dc.html` — prototypes haute fidélité, référence pixel.
- `~/.gstack/projects/owlog-app/tx-dev-design-*.md` — document de design : modèle d'événements, règles de dérivation, ordre de construction, critères de réussite. **Le lire avant toute décision d'architecture.**

## Règles projet — non négociables

### Langue du code

**Le code s'écrit en anglais. Toujours, sans exception.** Noms de fonctions, de variables, de types, de fichiers, de champs, de clés, de valeurs stockées, de tables et de colonnes.

Le français est réservé aux **commentaires**, à la **documentation**, aux **messages de commit** et aux **noms de tests** — qui sont de la prose descriptive, pas du code.

Les chaînes affichées à l'utilisateur ne sont écrites en dur dans aucune langue : elles passent par l'i18n.

**Ne jamais déduire la langue du code de la langue du projet.** Owlog est documenté en français, son interface est en français, ses commits sont en français. Son code est en anglais. Le mimétisme avec la documentation est précisément l'erreur à éviter.

### Commits

- **Jamais de co-auteur.** Aucun `Co-Authored-By`, aucune mention d'outil ou d'assistant dans un message de commit.
- Messages en français, à l'impératif, préfixés par un type (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`).

### Développement piloté par les tests

Le test précède le code. La discipline s'applique là où elle a du sens :

| Couche | Règle |
|---|---|
| `domain/commands/` — construction d'événements | **TDD strict.** C'est là que vivent les règles délicates : rattachement du rétro-datage, attribution de `cycle_key`, horodatage |
| `domain/reducers/` — projections | **TDD strict.** Fonctions pures sur une liste d'événements, aucun DOM |
| `adapters/` | Tests d'intégration contre le port, écrits avant l'adaptateur |
| `owlog-api` | Tests de route avant implémentation |
| `ui/` — recréation au pixel | Pas de TDD. Le contrôle est la comparaison visuelle des captures à 375px avec les prototypes |

Runner : Vitest.

### Architecture hexagonale

Le domaine ne connaît aucune infrastructure. C'est ce qui rendra le passage à Postgres (temps 2) un remplacement d'adaptateur et non une réécriture.

```
domain/
  commands/      construction d'événements : ajouter, avancerStatut, progresser,
                 retroDater, revoir, annuler. Zéro effet de bord.
  reducers/      projections : cycles, currentStatus, mediaState, journal…
  rules/         rang des cycles, rattachement du rétro-datage, dérivation du statut
ports/           EventStore, MediaCatalog, Clock, IdGenerator   (interfaces)
adapters/
  dexie/         EventStore (append, eventsForMedia, allMediaStates, eventsSince)
                 + media_state (dérivée) + media_cache + pending_adds + settings
  tmdb-http/     MediaCatalog via owlog-api
  browser/       Clock, IdGenerator
ui/              React + Tailwind. N'appelle que commands/ et reducers/.
```

`Clock` et `IdGenerator` sont des ports : le domaine génère des UUIDv7 et des horodatages, et sans injection les règles de rang ne sont pas testables de façon déterministe.

**`commands/` est aussi important que `reducers/`.** Toute la subtilité du modèle est en écriture. Sans cette couche, les règles atterrissent dans les composants React, la seule couche exemptée de TDD.

**Interdit :** un import de `dexie`, de `fetch` ou de `Date` dans `domain/`.

### DRY

Une règle métier n'existe qu'à un endroit. Points de vigilance sur ce projet :

- la règle de rang des cycles, utilisée par la numérotation `#N`, par la dérivation du statut et par le tri du journal ;
- le calcul de `total_runtime` ;
- les tokens du design — d'où l'interdiction des valeurs Tailwind arbitraires ci-dessous.

### SOLID

- **Responsabilité unique** : un réducteur produit une projection, jamais deux.
- **Ouvert/fermé** : ajouter un type de média (anime, livre, musique) ne doit modifier aucun réducteur existant.
- **Inversion des dépendances** : déjà l'ossature de l'hexagone, le domaine dépend des ports, jamais l'inverse.

### Documentation du code

Tout élément est documenté : chaque type d'événement, chaque réducteur, chaque port, chaque adaptateur. Les règles non évidentes (rang des cycles, rattachement du rétro-datage, dérivation du statut) portent leur justification dans le code, pas seulement dans le document de design.

### Diagrammes ASCII

Deux diagrammes vivent en commentaire dans le code, recopiés du document de design :

- le pipeline événements vers écrans, en tête de `domain/index.ts` ;
- la machine à états du statut et la règle de rang, en tête de `domain/rules/status.ts`.

**Les maintenir fait partie de la modification.** Toucher une règle de dérivation sans mettre à jour le diagramme dans le même commit est un défaut de revue. Un diagramme périmé induit activement en erreur ; il est pire que pas de diagramme.

### Pas de code mort

Aucun code commenté, aucun bloc désactivé, aucun TODO orphelin n'est commité — sur `main` comme ailleurs. La documentation reste entière partout, y compris sur `main` ; ce qui est banni, c'est le déchet.

Pas de dépouillement automatique des commentaires au merge : `main` doit rester déboguable, avec des numéros de ligne qui correspondent à ce qu'on lit en local. Application par lint (`eslint` sur le code commenté, `no-warning-comments`), pas par étape de build.

## Stack

- **pnpm** pour la gestion des paquets, en workspace (`owlog-web`, `owlog-api`, types partagés).
- **Vite + React + TypeScript**, SPA pure. Pas de SSR : rien à rendre côté serveur, et le SSR entre en conflit avec le service worker.
- **Tailwind CSS**, thème alimenté par les tokens du handoff.
- **Dexie.js** (IndexedDB) : `events` est la source de vérité ; `media_state` est **dérivée**, reconstructible, jamais autoritaire ; `pending_adds` est la file d'ajouts hors-ligne, ce ne sont pas des événements.
- **Append-only strict.** Rien n'est jamais muté ni supprimé. Une correction est un événement `VOID {target}`, filtré en tête de chaîne par `applyVoids`.
- **TanStack Query**, cache mémoire seul. Pas de `persistQueryClient` : `media_cache` est la seule source hors-ligne.
- **`uuidv7`** — `crypto.randomUUID()` ne produit que de l'UUIDv4, non ordonnable.
- **`vite-plugin-pwa`** (Workbox), stratégie `prompt` + `registration.update()` horaire.
- **`wouter`** en mode history. Impose un rewrite SPA côté Caddy et `navigateFallback`.
- **`dexie-react-hooks`** (`useLiveQuery`) pour la réactivité locale.
- **`lucide-react`** pour les icônes.
- **Hono** pour `owlog-api`. **`tmdb-ts` côté serveur uniquement** — la clé TMDB n'entre jamais dans le bundle client.
- **Vitest** pour les tests.

### Tailwind et le design verrouillé

Les tokens du handoff **sont** le thème Tailwind (`@theme` en v4). Les classes lisent `bg-surface text-accent border-accent`.

**Interdit :** les valeurs arbitraires sur les tokens (`bg-[#121724]`, `text-[#27FF93]`). Elles dupliquent le design system et le font diverger. Les valeurs arbitraires de géométrie ponctuelle (`w-[104px]` pour une affiche) sont tolérées.

## Internationalisation

Deux langues au lancement : français et anglais. **Aucune chaîne affichable n'est écrite en dur dans un composant** — tout passe par `src/i18n/fr.json` et `en.json`, via `react-i18next`.

Les clés sont typées sur le catalogue français : une clé absente échoue à la compilation plutôt que d'afficher son propre nom à l'écran.

La langue est persistée en `localStorage` (`owlog.language`), pas dans `settings` : elle doit être connue avant le premier rendu, et une lecture IndexedDB est asynchrone.

Le sélecteur de langue dans le header est **temporaire**, le temps de la construction. Sa place définitive est un écran de réglages qui n'existe pas encore.

Les messages d'erreur levés par le code sont en anglais : ils s'adressent au développeur, pas à l'utilisateur, et ne passent pas par l'i18n.

## Secrets

**Doppler**, projet `owlog-app`. Aucun secret n'est versionné, ni en clair ni chiffré, et aucun `.env` n'est commité.

```bash
doppler run -- pnpm dev          # développement
doppler secrets download --no-file --format env   # inspection
```

Secrets attendus à l'étape 3, côté `owlog-api` uniquement :

| Nom | Rôle |
|---|---|
| `TMDB_API_KEY` | Clé v3 de The Movie Database |
| `TMDB_READ_TOKEN` | Jeton de lecture v4 |

**À faire avant l'étape 3 :** les secrets existants s'appellent `TVDB_API_KEY` et `TVDB_API_TOKEN`. TheTVDB et TMDB sont deux APIs différentes ; le projet est bâti sur TMDB, jusqu'au format de référence `tmdb:movie/…` gravé dans le type `MediaRef` et dans les 126 tests du domaine. Les secrets sont donc à renommer côté Doppler.

La clé ne quitte jamais `owlog-api`. Elle n'entre à aucun moment dans le bundle client, qui ne connaît que `/search` et `/media/:ref`.

## Déploiement

Dokploy sur VPS personnel, domaine chez Cloudflare. Deux services : `owlog-web` (statique, servi par Caddy) et `owlog-api` (Hono). Cible temps 2 : Postgres auto-hébergé sur le même Dokploy, avec une API maison — pas Supabase.

Pièges connus : `Cache-Control: no-cache` sur `index.html` et `immutable` sur les assets hachés, sinon les déploiements restent invisibles. La clé TMDB ne quitte jamais `owlog-api`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
