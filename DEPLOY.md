# Déploiement

Deux services sur Dokploy, **un seul domaine**. `owlog-web` sert la racine, `owlog-api` répond sous `/api`. **Seule `main` est déployée** — `dev` ne l'est jamais, et `main` ne reçoit `dev` qu'au moment d'une mise en ligne.

Une seule origine, donc : pas de CORS, pas de second certificat, pas de second enregistrement DNS. Le navigateur voit une requête de même origine, ce qui supprime aussi la requête de contrôle préalable que le jeton partagé — un en-tête non standard — déclencherait sur un sous-domaine.

> Les images n'ont pas pu être construites sur la machine de développement, faute de Docker. Ce qui **a** été vérifié : `owlog-api` démarre sous la commande exacte du conteneur (`node --experimental-strip-types src/server.ts`), répond `{"status":"ok"}` sur `/health`, `401` sans jeton et `502` quand TMDB refuse le jeton. Un test de fumée le rejoue à chaque exécution de la suite.

## Avant de commencer

| Prérequis | État |
|---|---|
| Dépôt GitHub | fait — `t3hx/owlog-app`, privé |
| Jeton TMDB dans Doppler | fait — `TMDB_API_TOKEN`, mais **dans `dev` seulement** |
| Trois secrets à créer dans la config `prd` | **à faire** — voir ci-dessous |
| Projet Dokploy sur le VPS | **à faire** |
| Enregistrement DNS vers le VPS | **à faire** |

## 1. Secrets

La config `prd` est **vide** : `TMDB_API_KEY` et `TMDB_API_TOKEN` n'existent que dans `dev`. Trois secrets sont donc à poser.

```bash
# Le jeton TMDB, recopié depuis dev. C'est le seul vrai secret des trois,
# et il ne quitte jamais owlog-api.
doppler secrets set TMDB_API_TOKEN="$(doppler secrets get TMDB_API_TOKEN --plain \
  --project owlog-app --config dev)" --project owlog-app --config prd

# Un jeton partagé, tiré au sort. Il n'est pas secret — il finit dans le
# bundle web, lisible par quiconque ouvre les outils de développement.
doppler secrets set OWLOG_SHARED_TOKEN="$(openssl rand -hex 24)" --project owlog-app --config prd

# Les réseaux internes de Docker. Voir la note ci-dessous : ce sont des
# plages, pas des adresses.
doppler secrets set OWLOG_TRUSTED_PROXIES="10.0.0.0/8,172.16.0.0/12" --project owlog-app --config prd
```

`OWLOG_ALLOWED_ORIGINS` reste **vide** : même origine, donc aucun CORS. Le middleware ne se monte pas quand la liste est vide, ce qui est le comportement voulu.

### Pourquoi des plages et non des adresses

`owlog-api` ne voit jamais l'adresse du visiteur : il voit celle de Traefik, sur le réseau Docker. Sans liste de confiance, il refuse tout en-tête d'IP et compte **tout le monde dans le même seau** — le premier utilisateur qui dépasse coupe le service pour tous.

Or l'adresse de Traefik est attribuée par Docker et change quand le proxy est recréé. Une adresse exacte serait juste le jour du déploiement et fausse ensuite, sans que rien ne le signale. D'où les plages : `10.0.0.0/8` couvre les réseaux `overlay` de Docker Swarm, `172.16.0.0/12` les réseaux `bridge`. Déclarer les deux couvre les deux modes de Dokploy.

`CF-Connecting-IP` est préféré dès que la liste est non vide : Cloudflare l'écrase toujours, c'est la seule valeur qu'un client ne peut pas forger — **à condition que le trafic passe réellement par Cloudflare**. Garde donc le nuage orange activé, et si le VPS a un pare-feu, n'ouvre 80/443 qu'aux plages de Cloudflare. Sans cela, quelqu'un qui trouve l'IP d'origine contourne la limitation en posant l'en-tête lui-même.

## 2. DNS

Un seul enregistrement, chez Cloudflare :

| Type | Nom | Contenu | Proxy |
|---|---|---|---|
| `A` | `owlog` (ou `@`) | IP du VPS | **activé** (nuage orange) |

## 3. Service `owlog-api`

Crée-le **en premier** : il se teste seul, alors que le web dépend de son adresse.

| Réglage Dokploy | Valeur |
|---|---|
| Type | Application |
| Source | GitHub, `t3hx/owlog-app`, branche `main` |
| Build Type | `Dockerfile` |
| Docker File | `apps/api/Dockerfile` |
| Docker Context Path | `.` — **la racine du dépôt** |
| Container Port | `8787` |

Le contexte de build est la racine et non `apps/api` : c'est un workspace pnpm, le lockfile et `@owlog/contracts` vivent à la racine. Un contexte sur `apps/api` échoue à l'installation.

**Domaine :**

| Champ | Valeur |
|---|---|
| Host | `<DOMAINE>` |
| Path | `/api` |
| **Strip Path** | **activé** |
| Container Port | `8787` |
| HTTPS | activé, Let's Encrypt |

`Strip Path` n'est pas optionnel. Les routes de Hono sont `/health`, `/search`, `/media/:ref` — sans lui, le service reçoit `/api/search` et répond `404` sur tout. C'est le premier symptôme à reconnaître.

**Variables d'environnement** (depuis Doppler) :

```
TMDB_API_TOKEN=<depuis Doppler>
OWLOG_SHARED_TOKEN=<depuis Doppler>
OWLOG_TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12
PORT=8787
```

**Vérification, avant de toucher au web :**

```bash
curl https://<DOMAINE>/api/health
# {"status":"ok"}
# 404 ici  ->  Strip Path n'est pas activé.
# 502 ici  ->  le conteneur ne démarre pas : lis ses logs, la config
#              échoue bruyamment et nomme le secret manquant.

curl -o /dev/null -w "%{http_code}\n" "https://<DOMAINE>/api/search?q=dune"
# 401 — sans jeton, c'est le comportement attendu

curl -s -H "x-owlog-token: <OWLOG_SHARED_TOKEN>" \
  "https://<DOMAINE>/api/search?q=dune" | head -c 200
# la liste des résultats — si tu vois 502 ici, c'est TMDB qui refuse le
# jeton, donc TMDB_API_TOKEN.
```

## 4. Service `owlog-web`

| Réglage Dokploy | Valeur |
|---|---|
| Type | Application |
| Source | GitHub, `t3hx/owlog-app`, branche `main` |
| Build Type | `Dockerfile` |
| Docker File | `apps/web/Dockerfile` |
| Docker Context Path | `.` — **la racine du dépôt** |
| Container Port | `80` |

**Domaine :**

| Champ | Valeur |
|---|---|
| Host | `<DOMAINE>` |
| Path | `/` |
| Strip Path | désactivé |
| Container Port | `80` |
| HTTPS | activé, Let's Encrypt |

Les deux services partagent le même hôte. Traefik classe ses règles par spécificité : `Host(...) && PathPrefix(/api)` l'emporte sur `Host(...)`, donc `/api` va bien à l'API et tout le reste au web. Aucun réglage de priorité à poser à la main.

**Arguments de build** — des *arguments*, pas des variables d'exécution : ils sont figés dans le bundle au moment du build.

```
VITE_API_URL=/api
VITE_SHARED_TOKEN=<la même valeur que OWLOG_SHARED_TOKEN>
```

Changer `OWLOG_SHARED_TOKEN` demande donc de **reconstruire** `owlog-web`, pas seulement de le redémarrer. Et de le reconstruire *après* avoir mis à jour l'API, sinon le client envoie l'ancien jeton et récolte des `401`.

## 5. Après la première mise en ligne

Dérouler `CHECKLIST.md` sur un téléphone réel. À ce stade, les six parcours sont testables — les deux derniers, sur la file hors-ligne, sont arrivés avec l'étape 4.

## 6. Le piège à vérifier en premier

Déployer une **seconde** fois, puis vérifier qu'un client déjà ouvert voit le bandeau au retour au premier plan, et que le rechargement sert la nouvelle version **sans vider le cache**.

C'est le défaut le plus coûteux de cette étape, et il est silencieux : sans `Cache-Control: no-cache` sur `index.html` et sur `sw.js`, le navigateur garde l'ancien document, qui référence l'ancien bundle. L'application marche parfaitement — elle est simplement périmée, indéfiniment. Le `Caddyfile` pose ces en-têtes ; ce test vérifie qu'ils arrivent jusqu'au client à travers Cloudflare, qui applique ses propres règles.

```bash
curl -sI https://<DOMAINE>/ | grep -i "cache-control\|cf-cache-status"
# cache-control: no-cache        <- attendu
curl -sI https://<DOMAINE>/sw.js | grep -i "cache-control"
# cache-control: no-cache        <- attendu
```

Si Cloudflare écrase ces en-têtes, créer une règle de cache qui contourne `/`, `/index.html`, `/sw.js`, `/registerSW.js` et `/manifest.webmanifest`.

## 7. Passage de `dev` à `main`

```bash
git switch main
git merge --no-ff dev -m "Deploiement: etape 3 — proxy TMDB et PWA installable"
git push origin main
```

Dokploy déclenche le build sur `main`. `git log main` répond alors à la question « qu'est-ce qui tourne en ligne, maintenant ? », ce qui est le seul rôle de cette branche.

## Corriger ce document

Il décrit une procédure dont la partie Dokploy n'a pas encore été exécutée. **Au premier passage, corrige-le dans le même commit** que le déploiement : un document de mise en ligne faux coûte plus cher que pas de document, parce qu'on lui fait confiance à trois heures du matin.
