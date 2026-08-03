# Owlog

PWA mobile-first de suivi de contenus médias (films et séries au lancement, extensible animes, livres, audiobooks, musique). Interface en **français**. Ambiance nocturne épurée, cyberpunk sobre, dimension « log informatique » subtile.

Objectif produit central : **ajouter un contenu avec le moins de clics possible**.

Thèse produit : **le visionnage est l'unité d'enregistrement, pas le film.** Un store d'événements append-only est la source de vérité ; statut, progression, `✓ vu ×N`, journal et statistiques sont des projections calculées, jamais stockées.

## Documents de référence

- `docs/design_handoff_owlog/README.md` — spécification des 9 écrans, tokens, composants, règles ♥ et revisionnage. **Le design est verrouillé, il ne se rediscute pas.**
- `docs/design_handoff_owlog/design-system.md` — résumé des tokens et règles.
- `docs/design_handoff_owlog/*.dc.html` — prototypes haute fidélité, référence pixel.
- `~/.gstack/projects/owlog-app/tx-dev-design-*.md` — document de design : modèle d'événements, règles de dérivation, ordre de construction, critères de réussite. **Le lire avant toute décision d'architecture.**

## Règles projet — non négociables

### Langue du code

**Le code s'écrit en anglais. Toujours, sans exception.** Noms de fonctions, de variables, de types, de fichiers, de champs, de clés, de valeurs stockées, de tables et de colonnes.

Le français est réservé aux **commentaires**, à la **documentation** — qui sont de la prose descriptive, pas du code.

Les chaînes affichées à l'utilisateur ne sont écrites en dur dans aucune langue : elles passent par l'i18n.

**Ne jamais déduire la langue du code de la langue du projet.** Owlog est documenté en français, son interface est en français, ses commits sont en français. Son code est en anglais. Le mimétisme avec la documentation est précisément l'erreur à éviter.

### Commits

- **Jamais de co-auteur.** Aucun `Co-Authored-By`, aucune mention d'outil ou d'assistant dans un message de commit.
- Messages en français, à l'impératif, préfixés par un type (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`).
- **Titre de PR : deux-points collés au type**, `feat(web): ajouter le journal`
  — PAS `feat(web) :`. L'espace fine française avant `:` **casse** le lint
  `pr-title` (`ci.yml`), qui suit la spec Conventional Commits (le `:` colle au
  type/scope). Le français reste libre dans la **description** qui suit. Comme
  la fusion est un squash, c'est le **titre de PR** qui devient le commit du
  tronc — lui seul doit être un commit conventionnel valide, pas les commits
  intermédiaires de la branche.

### Branches et validation

- **Tout travail de feature se fait sur une branche** `feat/...` ou `fix/...`
  tirée de `main` (noms en anglais, US only), jamais directement sur `main`.
- La branche rejoint `main` par une **PR en squash-merge** — un commit propre
  par feature, dont le titre (conventionnel) devient le message sur le tronc.
- **Aucune feature n'est clôturée sans validation manuelle de l'utilisateur.**
  Avant toute fusion sur `main` et toute fermeture de ticket : présenter la
  branche à tester (commande de lancement, points précis à vérifier) et
  attendre son retour. Les tests automatisés verts ne remplacent pas ce
  passage.
- Tolérance : documentation et micro-corrections de configuration peuvent
  aller directement sur `main`.
- **Tronc unique `main`.** Le projet a migré du couple `dev`/`main` vers un
  seul tronc `main` (workflow solo v3, T3H-73) : c'est `main` que visent la
  CI, release-please et le déploiement.

### Développement piloté par les tests

Le test précède le code. La discipline s'applique là où elle a du sens :


| Couche                                         | Règle                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `domain/commands/` — construction d'événements | **TDD strict.** C'est là que vivent les règles délicates : rattachement du rétro-datage, attribution de `cycle_key`, horodatage |
| `domain/reducers/` — projections               | **TDD strict.** Fonctions pures sur une liste d'événements, aucun DOM                                                           |
| `adapters/`                                    | Tests d'intégration contre le port, écrits avant l'adaptateur                                                                   |
| `owlog-api`                                    | Tests de route avant implémentation                                                                                             |
| `ui/` — recréation au pixel                    | Pas de TDD. Le contrôle est la comparaison visuelle des captures à 375px avec les prototypes                                    |


Runner : Vitest.

### Architecture hexagonale

Le domaine ne connaît aucune infrastructure. C'est ce qui rendra le passage à Postgres (temps 2) un remplacement d'adaptateur et non une réécriture.

```
packages/domain/src/      package workspace `@owlog/domain`, exporté en source
                          (pas de build), consommé par le web ET par l'API —
                          le serveur rejoue les mêmes réducteurs que le client
  commands/      construction d'événements : ajouter, avancerStatut, progresser,
                 retroDater, revoir, annuler. Zéro effet de bord.
  reducers/      projections : cycles, currentStatus, mediaState, journal…
  rules/         rang des cycles, rattachement du rétro-datage, dérivation du statut
  ports/         Clock, IdGenerator — les seuls ports que le domaine consomme
apps/web/src/
  ports/         EventStore, MediaCatalog…   (interfaces, côté application)
  adapters/
    dexie/       EventStore (append, eventsForMedia, allMediaStates, eventsSince)
                 + media_state (dérivée) + media_cache + pending_adds + settings
    tmdb-http/   MediaCatalog via owlog-api
    browser/     Clock, IdGenerator
  ui/            React + Tailwind. N'appelle que commands/ et reducers/.
```

`Clock` et `IdGenerator` sont des ports : le domaine génère des UUIDv7 et des horodatages, et sans injection les règles de rang ne sont pas testables de façon déterministe. Ils vivent **dans** le package — ce sont les seuls ports que le domaine consomme lui-même — quand les autres ports restent côté `apps/web`.

Contrainte du package : l'API tourne sous `node --experimental-strip-types`. Les imports internes de `packages/domain` sont donc **relatifs, à extension `.ts` explicite** (aucun alias `@/`), et le code n'utilise aucune syntaxe non strippable (enum, namespace, paramètres-propriétés).

`**commands/` est aussi important que `reducers/`.** Toute la subtilité du modèle est en écriture. Sans cette couche, les règles atterrissent dans les composants React, la seule couche exemptée de TDD.

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

- le pipeline événements vers écrans, en tête de `packages/domain/src/index.ts` ;
- la machine à états du statut et la règle de rang, en tête de `packages/domain/src/rules/status.ts`.

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
- `**uuidv7**` — `crypto.randomUUID()` ne produit que de l'UUIDv4, non ordonnable.
- `**vite-plugin-pwa**` (Workbox), stratégie `prompt` + `registration.update()` horaire.
- `**wouter**` en mode history. Impose un rewrite SPA côté Caddy et `navigateFallback`.
- `**dexie-react-hooks**` (`useLiveQuery`) pour la réactivité locale.
- `**lucide-react**` pour les icônes.
- **Hono** pour `owlog-api`. `**tmdb-ts` côté serveur uniquement** — la clé TMDB n'entre jamais dans le bundle client.
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


| Nom                     | Où          | Rôle                                                      |
| ----------------------- | ----------- | --------------------------------------------------------- |
| `TMDB_API_TOKEN`        | `owlog-api` | Jeton de lecture v4. Ne quitte jamais le serveur          |
| `TMDB_API_KEY`          | `owlog-api` | Clé v3, non utilisée par le code actuel                   |
| `OWLOG_SHARED_TOKEN`    | les deux    | Jeton partagé, public par nature                          |
| `OWLOG_ALLOWED_ORIGINS` | `owlog-api` | Origines CORS autorisées                                  |
| `OWLOG_TRUSTED_PROXIES` | `owlog-api` | Adresses ou **plages CIDR** des proxies devant le service |
| `OWLOG_BASE_PATH`       | `owlog-api` | Préfixe de montage, `/api` en production                  |

Ajoutés au temps 2 (tous optionnels : sans eux, l'API reste le proxy TMDB du temps 1) :

| Nom | Où | Rôle |
|---|---|---|
| `DATABASE_URL` | `owlog-api` | Postgres. Absente : `/auth` et `/sync` répondent 503, le reste vit |
| `OWLOG_PUBLIC_ORIGIN` | `owlog-api` | Origine publique du web, pour les liens magiques des e-mails |
| `OWLOG_EMAIL_API_TOKEN` | `owlog-api` | Jeton du fournisseur d'e-mail. Absent : mailer console (dev) |
| `OWLOG_EMAIL_API_URL` | `owlog-api` | Endpoint du fournisseur (défaut : Resend) |
| `OWLOG_EMAIL_FROM` | `owlog-api` | Expéditeur, `Owlog <no-reply@…>` |


`OWLOG_TRUSTED_PROXIES` n'est pas optionnel en production : sans cette liste, le service refuse de croire les en-têtes d'IP et limite tout le monde sur l'adresse du proxy. Le premier utilisateur qui dépasse coupe alors le service pour tous.

Procédure complète de mise en ligne : [docs/DEPLOY.md](docs/DEPLOY.md).

La clé ne quitte jamais `owlog-api`. Elle n'entre à aucun moment dans le bundle client, qui ne connaît que `/search` et `/media/:ref`.

## Déploiement

Dokploy sur VPS personnel. Deux services : `owlog-web` (statique, servi par Caddy) et `owlog-api` (Hono), **sur un seul domaine** — `owlog.nspace.link` pour le web, `/api` pour le service. Une seule origine, donc aucun CORS et aucune requête de contrôle préalable. Cible temps 2 : Postgres auto-hébergé sur le même Dokploy, avec une API maison — pas Supabase.

L'infrastructure est décrite par [`docs/runbook-vps-dokploy.md`](docs/runbook-vps-dokploy.md), qui fait autorité. Deux traits en découlent : **aucun port web n'est ouvert en entrée** — le trafic arrive par un tunnel Cloudflare, donc pas d'enregistrement `A`, pas de Let's Encrypt — et l'origine parle HTTP en clair sur `dokploy-network`.

`owlog-api` se monte **lui-même** sous `/api` plutôt que de compter sur un « Strip Path » du proxy : rien ne garantit qu'un tel réglage existe, et l'hypothèse ne se vérifie qu'après un cycle de déploiement complet. Conséquence à connaître : la sonde de vie est `/api/health`, la racine répond `404`.

Pièges connus : `Cache-Control: no-cache` sur `index.html` et `immutable` sur les assets hachés, sinon les déploiements restent invisibles. La clé TMDB ne quitte jamais `owlog-api`.

### Vérifier avant de mettre en ligne

```bash
./scripts/local-prod.sh up      # construit les vraies images, démarre sur :8080
./scripts/local-prod.sh check   # rejoue les pièges connus de mise en ligne
./scripts/local-prod.sh down
```

`**pnpm dev` ne prouve rien de ce qui casse en production.** Il sert des modules non groupés, sans service worker, sans Caddy, sans préfixe de montage — c'est-à-dire sans aucune des pièces qui ont produit les pannes de déploiement de ce projet. Le script construit les vraies images depuis les vrais `Dockerfile` et les fait tourner dans la vraie topologie : une seule origine, `owlog-web` à la racine, `owlog-api` sous `/api`, derrière un Caddy frontal qui tient le rôle du tunnel.

`check` vérifie huit choses invisibles en développement, dont chacune a déjà coûté un cycle de déploiement : le rewrite SPA sur une route interne, `no-cache` sur `index.html` et sur le service worker, `immutable` sur les assets hachés, la sonde de l'API sous son préfixe, le fait qu'une navigation vers `/api` rende du JSON et non l'application, et l'absence de jeton TMDB dans le bundle.

**À lancer avant tout déploiement, et après toute modification touchant au routage, aux en-têtes, au service worker ou aux arguments de build.**

Deux frictions d'environnement à connaître : l'appartenance au groupe `docker` ne prend effet qu'à la session suivante — un shell ouvert avant le `usermod` doit passer par `sg docker -c '...'` — et le plugin `docker compose` peut manquer, d'où des `docker run` explicites plutôt qu'un fichier compose.

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

