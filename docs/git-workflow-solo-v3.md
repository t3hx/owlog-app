# Workflow développeur solo — v3
## jj + GitHub (Issues/Projects/Actions) + Dokploy + gstack/gbrain + Claude Design

> Stack cible des exemples : **Vue 3 + TypeScript + Vite + pnpm + Vitest + Node 22**.
> Invariants : trunk-based · Conventional Commits · squash merge · build sur GitHub Actions **jamais** sur le VPS.

---

# PARTIE A — GitHub Projects : le projet global multi-repos

## A.1 Démythification

**Un Project v2 au niveau utilisateur PEUT contenir des issues de tous tes repos.** Ce qui est limité, ce n'est pas le Project, c'est l'**auto-add** :

| Capacité | Multi-repo ? |
|---|---|
| Contenir des items de plusieurs repos | ✅ Oui, nativement, sans limite de repos |
| Ajouter manuellement / via `gh` / via API | ✅ Depuis n'importe quel repo |
| Workflows intégrés (Item closed → Done, PR merged → Done, auto-archive) | ✅ S'appliquent à tous les items, peu importe leur repo d'origine |
| **Workflow "Auto-add to project"** | ⚠️ 1 workflow = 1 repo. Quota : **Free = 1, Pro = 5** |

C'est ce dernier point qui donne l'impression qu'un projet global est impossible. La solution : **ne pas dépendre de l'auto-add intégré** et pousser les items vers le Project depuis chaque repo via une GitHub Action officielle (`actions/add-to-project`). Nombre de repos illimité, filtres par labels, et le YAML vit dans ton template de repo donc zéro maintenance.

## A.2 Mise en place (une fois)

### 1. Créer le Project utilisateur

```bash
gh project create --owner "@me" --title "nspace"
gh project list --owner "@me"          # noter le NUMBER (ex: 1)
```

### 2. Créer le PAT pour l'automatisation

`GITHUB_TOKEN` est scopé au repo et **ne peut pas accéder aux Projects** — il faut un PAT.

> ⚠️ **Piège connu** : pour un Project appartenant à un **compte personnel**, les fine-grained PAT ne proposent **aucune** permission "Projects" (elle n'existe que sous *Organization permissions*). C'est un trou assumé de GitHub. Deux chemins :

**Option A — PAT classic (recommandé en solo, chemin officiel) :**

- GitHub → Settings → Developer settings → **Tokens (classic)** → Generate new token
- Scopes : ✅ `project` + ✅ `repo` (requis car dépôts privés)
- Expiration 1 an, rappel calendrier pour la rotation.

**Option B — héberger le Project dans une org perso gratuite :**

- Créer une organisation (ex. `nspace-dev`), y créer le Project.
- Le fine-grained PAT devient possible : Resource owner = l'org · **Organization permissions → Projects: Read & Write** · **Repository permissions → Issues: Read + Pull requests: Read**.
- Contrepartie : soit tes repos migrent dans l'org, soit tu gères un project d'org référencé par des repos perso. Granularité supérieure, friction supérieure. À considérer si les classic tokens sont un jour dépréciés.

Dans les deux cas, nom du secret : `ADD_TO_PROJECT_PAT`, posé par repo à la création (checklist §D, étape 7) — les secrets Actions au niveau compte n'existent pas pour les comptes perso.

### 3. Le workflow à embarquer dans chaque repo

```yaml
# .github/workflows/project-sync.yml
name: project-sync
on:
  issues:
    types: [opened, reopened]
  pull_request:
    types: [opened, reopened]

jobs:
  add-to-project:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/add-to-project@v1.0.2
        with:
          project-url: https://github.com/users/<TON_USER>/projects/1
          github-token: ${{ secrets.ADD_TO_PROJECT_PAT }}
          # Optionnel : n'ajouter que certains labels
          # labeled: type:bug, type:feat
          # label-operator: OR
```

Le YAML est identique quelle que soit l'option de token (A ou B) — seule l'URL du project change si tu passes par une org (`/orgs/<org>/projects/N`). Résultat : chaque issue/PR ouverte dans n'importe quel repo équipé atterrit dans le board unique. Les workflows intégrés du Project (closed → Done, merged → Done, auto-archive) font le reste sans configuration par repo.

### 4. Configuration du Project lui-même

Champs (Settings du project) :

| Champ | Type | Valeurs |
|---|---|---|
| `Status` | single select | 📥 Inbox · 🎯 Todo · 🔨 In Progress · 👀 In Review · ✅ Done |
| `Priority` | single select | P0 · P1 · P2 · P3 |
| `Size` | single select | XS · S · M · L (≥ L → découper en sous-issues) |

Workflows intégrés à activer (menu ⋯ → Workflows) :

- `Item added to project` → Status: Inbox
- `Item closed` → Status: Done
- `Pull request merged` → Status: Done
- `Auto-archive items` → `is:issue is:closed updated:<@today-2w`

Vues à créer :

1. **Board** (par Status) — la vue de travail
2. **Table "Triage"** — filtre `status:Inbox`, tri Priority, session hebdo de 10 min
3. **Table "Now"** — filtre `status:"In Progress","In Review"` : ce qui est en vol, tous repos confondus
4. **Board par Repo** — group by Repository, pour voir la dispersion

### A.3 Pilotage quotidien en CLI

```bash
# Capturer une idée (de n'importe où)
gh issue create -R tx/mon-repo -t "Session leak on refresh" -l type:bug

# Voir le board sans quitter le terminal
gh project item-list 1 --owner "@me" -L 30

# Passer une carte In Progress (au moment du jj new)
gh project item-edit --project-id <PID> --id <ITEM_ID> \
  --field-id <STATUS_FIELD_ID> --single-select-option-id <IN_PROGRESS_ID>
```

Les IDs GraphQL s'obtiennent une fois avec `gh project field-list 1 --owner "@me" --format json` ; encapsule ça dans une fonction fish `pj-start <issue-url>` si tu veux l'utiliser souvent. En pratique le duo `Closes #N` + workflows intégrés couvre 90 % des transitions automatiquement — ne sur-outille pas.

---

# PARTIE B — Code complet et fonctionnel (stack Vue 3 / TS / pnpm)

Tous les fichiers ci-dessous sont opérationnels tels quels. Deux profils couverts : **SPA statique** (Vue servi par nginx) et **service Node** (API/SSR) — la différence tient au Dockerfile, le reste est identique.

## B.1 `Dockerfile` — profil SPA (Vue + nginx)

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build          # → dist/

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
EXPOSE 8080
```

```nginx
# nginx.conf
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;

    location /healthz { return 200 "ok"; add_header Content-Type text/plain; }

    # SPA fallback
    location / { try_files $uri $uri/ /index.html; }

    # Assets fingerprintés par Vite → cache long
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
```

## B.2 `Dockerfile` — profil service Node (API / Nitro / SSR)

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build \
 && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./
USER app
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/healthz || exit 1
EXPOSE 3000
CMD ["node", "dist/index.mjs"]
```

> Le endpoint `/healthz` doit exister dans l'app (une route qui renvoie 200). C'est lui que Dokploy utilisera pour le rollback automatique.

## B.3 `.dockerignore`

```
node_modules
dist
.git
.jj
.github
*.md
.env*
coverage
.vscode
```

## B.4 `package.json` (scripts pertinents)

```json
{
  "packageManager": "pnpm@10.4.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "vue-tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

## B.5 `.github/workflows/ci.yml`

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4          # lit "packageManager" du package.json
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  # Le titre de PR devient le commit sur main (squash) → c'est LUI qu'on lint
  pr-title:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
    steps:
      - uses: amannn/action-semantic-pull-request@v6
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: |
            feat
            fix
            perf
            refactor
            docs
            style
            test
            build
            ci
            chore
            revert
          requireScope: false
```

## B.6 `.github/workflows/release.yml`

```yaml
name: release
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
```

À la racine du dépôt (au même niveau que `package.json`), deux fichiers de config (créés automatiquement au premier run, ou manuellement) :

```json
// release-please-config.json
{
  "packages": { ".": { "release-type": "node" } },
  "changelog-sections": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "perf", "section": "Performance" },
    { "type": "revert", "section": "Reverts" },
    { "type": "refactor", "section": "Refactoring", "hidden": true },
    { "type": "docs", "section": "Documentation", "hidden": true },
    { "type": "style", "section": "Styles", "hidden": true },
    { "type": "test", "section": "Tests", "hidden": true },
    { "type": "build", "section": "Build", "hidden": true },
    { "type": "ci", "section": "CI", "hidden": true },
    { "type": "chore", "section": "Miscellaneous", "hidden": true }
  ]
}
```

> La liste couvre volontairement **tous** les types de la convention (§ Partie E / v2 §4), mais seuls `feat`/`fix`/`perf`/`revert` sont visibles dans le CHANGELOG — les autres sont déclarés avec `"hidden": true`. Raison : le changelog s'adresse à l'utilisateur de l'app ; un `chore(deps)` ou un `refactor` interne n'y apporte que du bruit. C'est aussi le comportement par défaut de release-please (types absents = masqués) — la version explicite ci-dessus rend le choix visible et te permet de basculer un type en une ligne (`"hidden": false`) si tu veux, par exemple, exposer les `docs` sur un projet de bibliothèque.

```json
// .release-please-manifest.json
{ ".": "0.1.0" }
```

## B.7 `.github/workflows/deploy.yml`

```yaml
name: deploy
on:
  push:
    tags: ['v*']
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

# ── GHCR : rien à créer, tu as déjà un "compte" ──────────────────────
# ghcr.io est le registre d'images intégré à GitHub — pas un service
# externe, pas d'inscription. Chaque compte GitHub possède d'office son
# namespace : ghcr.io/<user>/*. Ici, ${{ github.repository }} vaut
# "tx/owlog", donc l'image sera ghcr.io/tx/owlog.
# L'authentification du push utilise GITHUB_TOKEN (fourni automatiquement
# à chaque run, permission packages:write déclarée dans le job) — aucun
# secret à créer côté push. L'image apparaîtra dans l'onglet "Packages"
# de ton profil GitHub, privée par défaut.
# Le seul credential à créer, c'est pour le PULL côté Dokploy (l'image
# étant privée) : un PAT classic avec le scope read:packages, à renseigner
# dans Dokploy → Registry (user: tx, password: le PAT, registry: ghcr.io).
# ─────────────────────────────────────────────────────────────────────

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=sha,format=long
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: production
    steps:
      # ─── Uniquement si Dokploy n'est accessible que via le tailnet ───
      - name: Connect to tailnet
        uses: tailscale/github-action@v4
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
          oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
          tags: tag:ci
      # ─────────────────────────────────────────────────────────────────

      - name: Deploy back
        run: |
          curl --fail-with-body -sS -X POST \
            "${{ secrets.DOKPLOY_URL }}/api/application.deploy" \
            -H 'accept: application/json' \
            -H 'Content-Type: application/json' \
            -H "x-api-key: ${{ secrets.DOKPLOY_TOKEN }}" \
            -d '{"applicationId": "${{ secrets.DOKPLOY_APP_ID_BACK }}"}'

      - name: Deploy front
        run: |
          curl --fail-with-body -sS -X POST \
            "${{ secrets.DOKPLOY_URL }}/api/application.deploy" \
            -H 'accept: application/json' \
            -H 'Content-Type: application/json' \
            -H "x-api-key: ${{ secrets.DOKPLOY_TOKEN }}" \
            -d '{"applicationId": "${{ secrets.DOKPLOY_APP_ID_FRONT }}"}'

      - name: Wait & verify health
        run: |
          sleep 45
          for i in $(seq 1 10); do
            code=$(curl -s -o /dev/null -w '%{http_code}' "${{ vars.APP_HEALTH_URL }}")
            [ "$code" = "200" ] && echo "healthy" && exit 0
            echo "attempt $i: $code — retrying in 15s"; sleep 15
          done
          echo "deployment did not become healthy" && exit 1
```

### B.7.b — Dokploy derrière Tailscale (panel non exposé publiquement)

Si — comme dans ton setup — le panel Dokploy n'est joignable que via le tailnet, un runner GitHub (public, éphémère) ne peut pas l'atteindre… sauf s'il **rejoint le tailnet le temps du job**. C'est exactement ce que fait le step `tailscale/github-action` ci-dessus : le runner devient un nœud **éphémère** tagué `tag:ci`, appelle l'API en privé, puis se déconnecte à la fin du job et est automatiquement supprimé du tailnet. Ton VPS ne s'expose jamais.

Setup une fois pour toutes, côté Tailscale (admin console) :

1. **ACL — déclarer le tag et restreindre sa portée** (Access Controls) :
   ```jsonc
   {
     "tagOwners": {
       "tag:ci": ["autogroup:admin"]
     },
     "acls": [
       // ⚠️ INDISPENSABLE : dès qu'une policy personnalisée existe, le
       // "allow all" implicite disparaît. Sans cette première règle, tu
       // t'enfermes dehors de ton propre tailnet (vécu).
       { "action": "accept",
         "src": ["autogroup:member"],
         "dst": ["*:*"] },

       // Le runner CI, lui, ne voit QUE le port du panel Dokploy sur le VPS :
       { "action": "accept",
         "src": ["tag:ci"],
         "dst": ["<IP-tailscale-du-VPS>:3000"] }
     ]
   }
   ```
   Un nœud `tag:ci` compromis ne peut donc rien atteindre d'autre sur ton tailnet — ni la workstation, ni le Pi. Toi (`autogroup:member`) gardes l'accès complet ; tu pourras resserrer cette règle plus tard, mais toujours en la testant **avant** de fermer l'onglet admin (la console garde une session ouverte — si tu te coupes l'accès, corrige la policy depuis cet onglet).

2. **OAuth client** : Settings → OAuth clients → Generate → scope **`auth_keys` (write)** + tag `tag:ci`. Récupérer Client ID + Secret.

3. **Secrets GitHub** (par repo, avec les autres) :
   ```bash
   gh secret set TS_OAUTH_CLIENT_ID --repo tx/mon-app
   gh secret set TS_OAUTH_SECRET    --repo tx/mon-app
   ```

4. **`DOKPLOY_URL` change de valeur** : elle doit pointer une adresse joignable *depuis le tailnet*. Deux options :
   - le FQDN MagicDNS complet du VPS : `http://<vps>.<tailnet>.ts.net:3000` — **FQDN complet obligatoire**, les hostnames courts MagicDNS ne résolvent pas de façon fiable sur les runners Linux (systemd-resolved) ;
   - ou l'IP Tailscale du VPS, stable par nœud : `http://100.x.y.z:3000`.
   
   **Option domaine propre — quel enregistrement DNS ?** Si tu veux garder `DOKPLOY_URL=https://dokploy.nspace.link` :
   - Dans Cloudflare : un enregistrement **A** → `dokploy` → **l'IP Tailscale du VPS** (`100.x.y.z`), en mode **DNS only** (nuage gris — le proxy Cloudflare ne peut pas joindre une IP CGNAT `100.64/10`, et de toute façon on ne veut pas de proxy ici). Le nom résout publiquement, mais seule une machine du tailnet peut effectivement s'y connecter — c'est le comportement voulu.
   - **Le port ne se met jamais dans le DNS** : un enregistrement A ne porte qu'une IP (le type SRV sait porter un port, mais ni curl ni les navigateurs ne le consultent pour HTTP). Le port va dans l'URL : `http://dokploy.nspace.link:3000`… 
   - …sauf si un reverse proxy écoute en 443 devant le panel. Deux façons propres d'y arriver : le Traefik intégré de Dokploy avec un certificat obtenu par **DNS challenge** Cloudflare (le HTTP challenge est impossible, l'hôte n'étant pas joignable publiquement) → `https://dokploy.nspace.link` sans port ; ou `tailscale serve` sur le VPS, qui publie le panel en HTTPS sur le port 443 de l'identité tailnet avec un certificat `ts.net` automatique → `https://<vps>.<tailnet>.ts.net`.
   - Le CNAME vers le FQDN MagicDNS est à éviter : la résolution publique des noms `ts.net` n'est pas garantie hors tailnet, alors que l'enregistrement A vers l'IP Tailscale (stable par nœud) fonctionne toujours.

Notes :
- Le step Tailscale ajoute ~5-10 s au job — négligeable pour un déploiement.
- Les nœuds créés par l'action sont pré-approuvés même si ton tailnet utilise la Device Approval, et nettoyés automatiquement après le run.
- Le step **Wait & verify health** n'a pas besoin du tailnet : il teste `APP_HEALTH_URL`, c'est-à-dire l'app *publique* (`mon-app.nspace.link`), pas le panel. Si un jour l'app elle-même est tailnet-only, même logique : elle sera joignable car le runner est encore connecté à ce moment du job.
- Si ton Dokploy est un jour exposé publiquement (il ne devrait pas), il suffit de retirer le step Tailscale — le reste du workflow est inchangé.

### B.7.c — Quel ID Dokploy prendre ?

**Le dernier segment de l'URL de chaque service — c'est lui, et rien d'autre.** L'avant-dernier segment de l'URL te dit le type, et le type te dit l'endpoint :

| L'URL contient… | Type | Endpoint | Body |
|---|---|---|---|
| `…/services/application/<ID>` | Application | `/api/application.deploy` | `{"applicationId": "<ID>"}` |
| `…/services/compose/<ID>` | Compose | `/api/compose.deploy` | `{"composeId": "<ID>"}` |

Exemple réel (owlog) — deux services **Application** dans l'environnement *production* :

```
…/project/Htmjwdqm5UslA8Xu00gM6/environment/Ej5FI9862NZU0BlYMQCyw/services/application/IRujnuR0-BPoZ4zpRHY29
   └─ projectId : ne sert pas    └─ environmentId : ne sert pas         └─ applicationId du BACK ✅
…/services/application/CZwiBBWuCCQJHDPg-XxIa   ← applicationId du FRONT ✅
```

Règles :
- **Un service = un ID = un secret = un appel.** Deux services à déployer → deux steps `curl` (le workflow B.7 ci-dessus en montre exactement deux : back puis front).
- Les IDs de projet et d'environnement existent mais **aucun endpoint ne déploie à ces niveaux** — il n'y a pas de `environment.deploy`.
- Vérifier qu'un ID est le bon avant de le mettre en secret :
  ```bash
  curl -s -H "x-api-key: $DOKPLOY_TOKEN" \
    "$DOKPLOY_URL/api/application.one?applicationId=<ID>" | jq .name
  ```
  → doit renvoyer le nom du service (`"back"`, `"front"`…). Une erreur = mauvais ID ou mauvais type (essayer `compose.one?composeId=`).

`APP_HEALTH_URL` est consommée dans le step **Wait & verify health** ci-dessus, via `${{ vars.APP_HEALTH_URL }}` — préfixe `vars.` (variable Actions) et non `secrets.`, c'est pour ça qu'elle ne saute pas aux yeux en cherchant les secrets. Valeur : `https://mon-app.nspace.link/healthz`. Ce second step transforme un déploiement "fire and forget" en déploiement vérifié — si l'app ne répond pas, le workflow est rouge et tu le sais.

> **Pourquoi `/healthz` et pas `/health` ?** Le chemin est un choix libre, pas une contrainte de l'outillage. `/healthz` est une convention (héritée de Google/Kubernetes) retenue ici **précisément** parce qu'elle a peu de chances d'entrer en collision avec une route métier existante — beaucoup d'APIs exposent déjà un `/health` ou `/api/health` avec leur propre sémantique (checks DB, dépendances…). Si ton conteneur a déjà une route de santé, **utilise-la** : il n'y a aucune raison d'en créer une seconde. La seule règle est la cohérence — le même chemin partout : `HEALTHCHECK` du Dockerfile, `nginx.conf` (profil SPA), healthcheck Dokploy, et la variable `APP_HEALTH_URL`. Un endpoint de santé, quatre consommateurs.

**Provenance et destination des 4 valeurs** (posées une fois par repo, cf. checklist §D étape 14) :

| Nom | Où l'obtenir | Où la mettre |
|---|---|---|
| `DOKPLOY_URL` | Panel **public** : `https://dokploy.nspace.link` (sans slash final). Panel **tailnet-only** (ton cas) : FQDN MagicDNS complet ou IP Tailscale du VPS, ex. `http://100.x.y.z:3000` — cf. §B.7.b | Secret Actions du repo |
| `DOKPLOY_TOKEN` | Clé API Dokploy — procédure détaillée ci-dessous | Secret Actions du repo |
| `DOKPLOY_APP_ID_BACK` / `DOKPLOY_APP_ID_FRONT` | Dernier segment de l'URL de chaque service : `…/services/application/`**`<id>`** — un ID par service (§B.7.c) | Secrets Actions du repo |
| `APP_HEALTH_URL` | Le domaine assigné à l'app dans Dokploy + ton chemin de santé (`/healthz` par convention, ou le `/health` déjà exposé par l'app — cf. note ci-dessus) | **Variable** Actions du repo (pas secret : rien de sensible, et visible dans les logs c'est utile) |

Deux façons de les poser : en CLI (`gh secret set NOM --repo tx/mon-app` puis coller la valeur, et `gh variable set` pour la variable — commandes exactes à l'étape 14 de la checklist), ou via l'UI GitHub : repo → **Settings → Secrets and variables → Actions** → onglet *Secrets* ou *Variables* → New.

**`DOKPLOY_TOKEN` — procédure complète :**

1. **Générer** : panel Dokploy → clique ton **avatar en haut à droite** → **Profile** (URL directe : `http://<ton-panel>:3000/dashboard/settings/profile`) → descends à la section **API/CLI** → bouton **Generate API Key**. Tu peux donner un nom à la clé (mets `github-actions` — dans six mois tu sauras à quoi elle sert et laquelle révoquer).
2. **Copier immédiatement** la valeur affichée. C'est une chaîne opaque ; traite-la comme un mot de passe root : la clé est rattachée à ton compte utilisateur Dokploy et donne **tous** ses droits sur l'API — déployer, mais aussi supprimer des services, lire les variables d'environnement, etc. Il n'existe pas de clé à portée réduite.
3. **Stocker la copie maîtresse** dans ton gestionnaire de secrets (Doppler, config perso — pas un fichier dans un repo). C'est elle que tu colleras dans chaque nouveau repo ; inutile de régénérer une clé par projet, une seule sert partout (mais tu *peux* en créer plusieurs si tu veux pouvoir révoquer finement).
4. **Tester avant de la mettre en secret** (depuis une machine du tailnet) :
   ```bash
   curl -s -H "x-api-key: COLLE_LA_CLE_ICI" \
     "http://sovereign-vps.tail3e6c7f.ts.net:3000/api/project.all" | jq '.[].name'
   ```
   → la liste des noms de tes projets. Un `401`/`Unauthorized` = clé mal copiée (espace ou retour à la ligne parasites en tête de soupçons).
5. **Poser en secret GitHub** : `gh secret set DOKPLOY_TOKEN --repo tx/owlog` puis coller — ou UI GitHub, Settings → Secrets and variables → Actions.
6. **Révoquer/faire tourner** : même section API/CLI du profil — supprimer la clé, en générer une nouvelle, mettre à jour le secret dans les repos. À faire si la clé fuite (log, copie d'écran…) ou une fois par an par hygiène.

## B.8 `.github/workflows/project-sync.yml`

→ cf. §A.2.3 (identique dans chaque repo).

## B.9 Template d'issue (optionnel mais rentable)

```yaml
# .github/ISSUE_TEMPLATE/task.yml
name: Task
description: Unité de travail standard
labels: ["type:feat"]
body:
  - type: textarea
    id: intent
    attributes:
      label: Intention
      description: Le problème à résoudre, pas la solution.
    validations: { required: true }
  - type: textarea
    id: done
    attributes:
      label: Definition of done
      placeholder: "- [ ] ..."
  - type: textarea
    id: notes
    attributes:
      label: Notes / décisions
```

---

# PARTIE C — Couche IA : gstack, gbrain, Claude Design

## C.1 Installation globale (une seule fois, pas par projet)

```bash
# gstack : les 23 skills de Garry Tan dans Claude Code
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git \
  ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```

Tout vit dans `~/.claude/` ; rien ne touche le PATH, MIT.

```bash
# gbrain : mémoire persistante inter-sessions, via le skill dédié
claude
> /setup-gbrain
```

Le skill détecte l'état de la machine, pose au plus trois questions et enchaîne install, init, enregistrement MCP dans Claude Code. Backend : **PGLite local** (recommandé pour toi — zéro service, cohérent avec ta philosophie) ou Supabase si tu veux un cerveau partagé entre workstation et MacBook.

**Politique de confiance par repo** — gbrain demande une fois par repo :
- `read-write` → défaut pour tes projets perso (l'agent lit ET enrichit le cerveau)
- `read-only` → repos tiers/clients (chercher sans contaminer)
- `deny` → repos invisibles pour gbrain

La décision est collante : partagée par tous les worktrees/branches du même remote — et donc par tous tes **workspaces jj**, qui pointent le même remote. Cohérence parfaite avec le §3.9 du workflow.

## C.2 Où chaque skill s'insère dans le cycle

| Étape du workflow | Skill / outil | Rôle |
|---|---|---|
| Idée floue → issue | `/office-hours` | Six questions de forçage sur ce que tu construis *vraiment* ; sort des capacités, des prémisses contestées, 3 approches chiffrées → matière brute des premières issues |
| Cadrage UI | **Claude Design** | cf. C.3 |
| Avant d'implémenter | `/plan-review` (gstack) | Revue du plan avant le code |
| Implémentation | Claude Code + jj workspaces | `jj workspace add` par agent, change IDs stables |
| Avant PR | `/code-review`, skills QA/security gstack | Revue self-service |
| Setup déploiement | ⚠️ **NE PAS utiliser** `/deploy-configurator` ni `/land-and-deploy` tels quels | Ton déploiement est figé : tag → Actions → GHCR → Dokploy. Ces skills configurent leur propre pipeline ; s'ils sont utilisés, les cadrer via CLAUDE.md (voir C.4) |
| Sécurité | `/careful`, `/freeze` | Garde-fous destructifs ; `/freeze` borne les éditions à un répertoire — précieux avec plusieurs agents en parallèle |
| Après chaque phase notable | `/keep-brain-current` | Ré-indexe le code du repo dans gbrain (`gbrain sources add` + `sync --strategy code`) et met à jour le bloc *GBrain Search Guidance* du CLAUDE.md projet |
| Rétro | skill retrospective gstack | Alimente gbrain en décisions/leçons |

## C.3 Claude Design dans la boucle UI

Claude Design (Anthropic Labs, plans Pro/Max) génère prototypes et maquettes, et surtout **fait l'aller-retour avec Claude Code** — c'est ce qui le rend intégrable proprement dans ce workflow plutôt qu'en outil isolé :

**Sens design → code :**
1. Dans Claude Design : décrire l'écran/le flow (ou partir d'une web capture de l'app existante pour que le prototype ressemble au vrai produit).
2. Itérer sur le canvas (commentaires inline, sliders d'ajustement, drag/resize).
3. **Export → "Hand off to Claude Code"** : bundle contenant les fichiers de design, le chat, et un README d'interprétation + un prompt prêt à coller.
4. Dans le repo (workspace jj dédié) : coller le prompt, Claude Code implémente sur ta stack (Vue 3 SFC + ton design system), en respectant le CLAUDE.md projet.

**Sens code → design :**
- `/design-sync` dans Claude Code : pousse ton design system (tokens, composants) depuis le repo vers Claude Design → tous les prototypes suivants utilisent TES composants, pas du générique.
- `/design` dans Claude Code : créer/éditer un projet Design sans quitter le terminal.
- Enregistrement MCP si besoin :
  ```bash
  claude mcp add --scope user --transport http claude-design \
    https://api.anthropic.com/v1/design/mcp
  ```

**Règle d'usage solo :** Claude Design sert à l'*exploration* (10 directions en 1h) et au *cadrage* (le prototype devient la spec attachée à l'issue — exporte le HTML ou une capture dans l'issue GitHub). L'implémentation reste dans le repo via le handoff, jamais de copier-coller manuel de code depuis le canvas.

## C.4 Câblage dans les CLAUDE.md

Ajouts au **`~/.claude/CLAUDE.md` global** (section CI/CD) :

```markdown
## AI tooling
- gstack skills are installed globally. Use /office-hours before creating epics,
  /plan-review before implementing, /code-review before opening PRs.
- gbrain is registered via MCP. Prefer `gbrain search` over Grep for
  decisions/history questions. Run /keep-brain-current after merging
  significant changes.
- Deployment is FROZEN: tag → GitHub Actions → GHCR → Dokploy API.
  Never let /deploy-configurator or /land-and-deploy create an alternative
  pipeline; deploys happen only by merging the release-please PR.
- UI work: prototype in Claude Design, sync the design system with
  /design-sync, implement via the handoff bundle in a dedicated jj workspace.
```

Le **CLAUDE.md projet** (créé à l'étape 9 de la checklist) contient : architecture, commandes (`pnpm dev/test/build`), scopes commit autorisés, et le bloc GBrain Search Guidance maintenu par `/keep-brain-current`.

---

# PARTIE D — Checklist de création d'un nouveau projet

> Ordre strict. Durée totale : ~30 min la première fois, ~12 min ensuite.
> Prérequis globaux déjà en place (une fois pour toutes) : Project "nspace" créé (§A.2.1), PAT `ADD_TO_PROJECT_PAT` généré (§A.2.2), gstack+gbrain installés (§C.1), un repo **`tx/template-app`** contenant les fichiers de la Partie B.

### Phase 1 — Cadrage (avant tout code)

- [ ] **1.** Session `/office-hours` dans Claude Code sur l'idée → en sortir 3-8 issues candidates (texte brut pour l'instant)
- [ ] **2.** Si le projet a une UI : session Claude Design → prototype des 2-3 écrans clés → exporter HTML/captures (spec visuelle) + garder le projet Design ouvert pour le handoff ultérieur

### Phase 2 — Repo & VCS

- [ ] **3.** Créer depuis le template :
  ```bash
  gh repo create tx/mon-app --private --template tx/template-app --clone
  cd mon-app
  ```
- [ ] **4.** Initialiser jj colocated :
  ```bash
  jj git init --colocate
  jj bookmark track main@origin
  ```
- [ ] **5.** Réglages du repo (merge & branches) :
  ```bash
  gh repo edit tx/mon-app \
    --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false \
    --squash-merge-commit-title PR_TITLE --squash-merge-commit-message PR_BODY \
    --delete-branch-on-merge --enable-issues
  ```
- [ ] **6.** Protection de `main` (required checks `verify` + `pr-title`, historique linéaire) :
  ```bash
  gh api -X POST repos/tx/mon-app/rulesets --input - <<'EOF'
  {
    "name": "protect-main",
    "target": "branch",
    "enforcement": "active",
    "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
    "rules": [
      { "type": "deletion" },
      { "type": "non_fast_forward" },
      { "type": "required_linear_history" },
      { "type": "pull_request", "parameters": {
          "required_approving_review_count": 0,
          "dismiss_stale_reviews_on_push": false,
          "require_code_owner_review": false,
          "require_last_push_approval": false,
          "required_review_thread_resolution": false } },
      { "type": "required_status_checks", "parameters": {
          "strict_required_status_checks_policy": true,
          "required_status_checks": [
            { "context": "verify" },
            { "context": "pr-title" } ] } }
    ]
  }
  EOF
  ```

### Phase 3 — Pilotage (Issues & Project)

- [ ] **7.** Secrets & labels :
  ```bash
  gh secret set ADD_TO_PROJECT_PAT --repo tx/mon-app   # colle le PAT
  for l in "type:bug:d73a4a" "type:feat:0e8a16" "type:chore:c5def5" \
           "type:idea:fbca04" "blocked:b60205" "needs-decision:5319e7" \
           "good-first-session:7057ff"; do
    IFS=: read -r name color <<< "$l"
    gh label create "$name" --color "$color" --repo tx/mon-app --force
  done
  ```
- [ ] **8.** Créer les issues de la phase 1 (`gh issue create …`) → elles tombent dans le board via `project-sync.yml` (déjà dans le template) → triage rapide (Priority/Size)

### Phase 4 — Contexte IA

- [ ] **9.** Écrire `CLAUDE.md` projet (architecture, commandes pnpm, scopes commit, liens vers les specs Design)
- [ ] **10.** Ouvrir Claude Code dans le repo → gbrain demande la politique → `read-write` → puis `/keep-brain-current` pour l'indexation initiale
- [ ] **11.** Si UI : `/design-sync` pour pousser le design system naissant vers Claude Design

### Phase 5 — Livraison

- [ ] **12.** Adapter `Dockerfile` (profil SPA ou Node, §B.1/B.2), vérifier `/healthz`, ajuster `release-please-config.json` et `.release-please-manifest.json` (`0.1.0`)
- [ ] **13.** Dokploy : créer l'application → provider **Docker registry** → image `ghcr.io/tx/mon-app:latest` → credentials GHCR (PAT `read:packages`) → domaine `mon-app.nspace.link` → healthcheck sur `/healthz` → rollback activé
- [ ] **14.** Secrets & variable de déploiement :
  ```bash
  gh secret set DOKPLOY_URL    --repo tx/mon-app --body "http://100.x.y.z:3000"   # IP/FQDN tailnet, cf. §B.7.b
  gh secret set DOKPLOY_TOKEN  --repo tx/mon-app          # API key profil Dokploy
  gh secret set DOKPLOY_APP_ID_BACK  --repo tx/mon-app    # URL du service back  : …/services/application/<id>
  gh secret set DOKPLOY_APP_ID_FRONT --repo tx/mon-app    # URL du service front : …/services/application/<id>  (§B.7.c)
  gh secret set TS_OAUTH_CLIENT_ID --repo tx/mon-app      # OAuth client Tailscale (§B.7.b)
  gh secret set TS_OAUTH_SECRET    --repo tx/mon-app
  gh variable set APP_HEALTH_URL --repo tx/mon-app --body "https://mon-app.nspace.link/healthz"
  ```
- [ ] **15.** Secrets applicatifs : config Doppler du projet → variables injectées dans Dokploy (jamais dans Actions, jamais dans l'image)

### Phase 6 — Validation de bout en bout

- [ ] **16.** Premier change réel :
  ```bash
  jj new main@origin -m "feat: bootstrap application shell

  Closes #1"
  # ... code ...
  jj git push -c @
  gh pr create --fill
  gh pr merge --squash --auto
  ```
- [ ] **17.** Vérifier la chaîne : CI verte → carte #1 en Done → Release PR release-please apparue → la merger → tag `v0.1.0` → workflow deploy vert (image sur GHCR + health 200) → `https://mon-app.nspace.link` répond
- [ ] **18.** `/keep-brain-current` + noter dans gbrain les décisions de bootstrap. Projet opérationnel.

> **Test du succès** : si l'étape 17 passe, tu ne toucheras plus jamais à l'infra de ce repo — tout le reste du cycle de vie est : issue → jj → PR → merge Release PR.

---

# PARTIE E — Rappels workflow quotidien (inchangé depuis v2)

```bash
jj git fetch && jj new main@origin -m "feat(scope): …\n\nCloses #42"
jj new                      # scratch layer
# ... travail, jj squash pour descendre les tranches ...
jj git push -c @-
gh pr create --fill && gh pr merge --squash --auto
```

Cas d'usage détaillés (interruption, fixup, split, stacked PRs, conflits différés, undo, spikes, workspaces multi-agents) : voir runbook v2 §3.
