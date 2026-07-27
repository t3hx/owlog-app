# Déploiement

Deux services sur Dokploy, un domaine chez Cloudflare. **Seule `main` est déployée** — `dev` ne l'est jamais, et `main` ne reçoit `dev` qu'au moment d'une mise en ligne.

> Cette procédure n'a **pas été exécutée**. Elle est écrite depuis le code et les contraintes du plan ; les Dockerfiles n'ont pas pu être construits localement, faute de Docker sur la machine de développement. Attends-toi à ajuster une ligne ou deux au premier passage, et corrige ce document quand tu le fais.

## Ce qu'il faut avant de commencer

| Prérequis | État |
|---|---|
| Dépôt GitHub | fait — `t3hx/owlog-app`, privé |
| Clé TMDB dans Doppler | fait — `TMDB_API_KEY`, `TMDB_API_TOKEN` |
| Projet Dokploy sur le VPS | **à faire** |
| Domaine pointé vers le VPS | **à faire** |
| Intégration Doppler ↔ Dokploy, ou secrets recopiés | **à faire** |

## Secrets

Doppler, projet `owlog-app`. Trois secrets sont nécessaires **en plus** de ceux de TMDB :

| Nom | Où | Rôle |
|---|---|---|
| `TMDB_API_TOKEN` | `owlog-api` | Jeton de lecture v4. **Ne quitte jamais le serveur.** |
| `OWLOG_SHARED_TOKEN` | les deux | Jeton partagé. Public par nature — il est dans le bundle web. |
| `OWLOG_ALLOWED_ORIGINS` | `owlog-api` | `https://ton-domaine` |
| `OWLOG_TRUSTED_PROXIES` | `owlog-api` | IP du reverse proxy Dokploy, séparées par des virgules |

`OWLOG_SHARED_TOKEN` n'est pas un secret au sens strict : il finit dans le bundle, donc lisible par quiconque ouvre les outils de développement. Il ne protège pas le service, il filtre le bruit. **La vraie protection du quota TMDB est la limitation de débit**, et celle-ci dépend entièrement de `OWLOG_TRUSTED_PROXIES` : sans cette liste, `owlog-api` refuse de faire confiance aux en-têtes d'IP et limite tout le monde sur une seule adresse — celle du proxy. Autrement dit, le premier utilisateur qui dépasse coupe le service pour tous.

Pour connaître l'IP à déclarer, une fois le service déployé :

```bash
# Depuis le VPS, en interrogeant le service à travers le proxy
docker logs <conteneur-owlog-api> | head
```

## Service 1 — `owlog-api`

| Réglage Dokploy | Valeur |
|---|---|
| Source | GitHub, `t3hx/owlog-app`, branche `main` |
| Type de build | Dockerfile |
| Chemin du Dockerfile | `apps/api/Dockerfile` |
| Contexte de build | **`.` (la racine du dépôt)** |
| Port exposé | `8787` |
| Domaine | `api.ton-domaine` |
| Health check | `/health` |

Le contexte de build est la racine et non `apps/api` : c'est un workspace pnpm, le lockfile et `@owlog/contracts` vivent à la racine. Un contexte sur `apps/api` échouerait à l'installation.

**Vérification :**

```bash
curl https://api.ton-domaine/health
# {"status":"ok"}

curl -o /dev/null -w "%{http_code}\n" "https://api.ton-domaine/search?q=dune"
# 401 — sans jeton, c'est le comportement attendu
```

## Service 2 — `owlog-web`

| Réglage Dokploy | Valeur |
|---|---|
| Source | GitHub, `t3hx/owlog-app`, branche `main` |
| Type de build | Dockerfile |
| Chemin du Dockerfile | `apps/web/Dockerfile` |
| Contexte de build | **`.` (la racine du dépôt)** |
| Port exposé | `80` |
| Domaine | `ton-domaine` |
| Health check | `/health` |

**Arguments de build** — ce sont des arguments, pas des variables d'exécution : ils sont figés dans le bundle au moment du build.

```
VITE_API_URL=https://api.ton-domaine
VITE_SHARED_TOKEN=<la même valeur que OWLOG_SHARED_TOKEN>
```

Changer `OWLOG_SHARED_TOKEN` demande donc de **reconstruire** `owlog-web`, pas seulement de le redémarrer.

## Après la première mise en ligne

Dérouler `CHECKLIST.md` sur un téléphone réel. Les six parcours indiquent l'étape à partir de laquelle ils s'appliquent ; à l'étape 3, quatre sont testables :

1. Installation depuis l'écran d'accueil
2. Mode avion — les polices doivent être les bonnes, **pas des polices système**
5. Bandeau de nouvelle version au retour au premier plan
6. Conformité au design des écrans déjà construits

Les parcours 3 et 4 (file d'ajouts hors-ligne) arrivent à l'étape 4.

## Le piège à vérifier en premier

Déployer une seconde fois, puis vérifier qu'un client **déjà ouvert** voit le bandeau au retour au premier plan, et que le rechargement sert bien la nouvelle version **sans vider le cache**.

C'est le défaut le plus coûteux de cette étape, et il est silencieux : sans `Cache-Control: no-cache` sur `index.html` et sur `sw.js`, le navigateur garde l'ancien document, qui référence l'ancien bundle. L'application marche parfaitement — elle est simplement périmée, indéfiniment. Le `Caddyfile` pose ces en-têtes ; ce test vérifie qu'ils arrivent bien jusqu'au client à travers Cloudflare, qui peut avoir ses propres règles de cache.

Si Cloudflare écrase les en-têtes, créer une règle de cache qui contourne `index.html`, `sw.js` et `manifest.webmanifest`.

## Passage de `dev` à `main`

```bash
git switch main
git merge --no-ff dev -m "Deploiement: etape 3 — proxy TMDB et PWA installable"
git push origin main
```

Dokploy déclenche le build sur `main`. `git log main` répond alors à la question « qu'est-ce qui tourne en ligne, maintenant ? », ce qui est le seul rôle de cette branche.
