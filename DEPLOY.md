# Déploiement

Deux services sur Dokploy, **un seul domaine** : `owlog.nspace.link`. `owlog-web` sert la racine, `owlog-api` répond sous `/api`. **Seule `main` est déployée** — `dev` ne l'est jamais, et `main` ne reçoit `dev` qu'au moment d'une mise en ligne.

Une seule origine : pas de CORS, pas de second certificat, et surtout pas de requête de contrôle préalable à chaque recherche — le jeton partagé voyage dans un en-tête non standard, qui en déclencherait une sur un sous-domaine.

L'infrastructure est décrite par [`runbook-vps-dokploy.md`](runbook-vps-dokploy.md), qui fait autorité sur tout ce qui n'est pas propre à Owlog. Deux traits en découlent et gouvernent ce document :

- **Aucun port web n'est ouvert en entrée.** Le trafic public arrive *par l'intérieur*, via le tunnel Cloudflare. Un enregistrement `A` vers l'IP publique — ce que proposent la quasi-totalité des tutoriels Dokploy — donnerait une **erreur 522** : Cloudflare n'atteindrait jamais l'origine.
- **Pas de Let's Encrypt.** Le challenge HTTP-01 exige que le port 80 soit joignable publiquement ; il ne l'est pas, et c'est voulu. Cloudflare termine le TLS à l'edge, le tunnel est chiffré, l'origine parle HTTP en clair sur `dokploy-network`.

> Les images n'ont pas pu être construites sur la machine de développement, faute de Docker. Ce qui **a** été vérifié : `owlog-api` démarre sous la commande exacte du conteneur (`node --experimental-strip-types src/server.ts`), se monte bien sous `/api`, répond `{"status":"ok"}` sur `/api/health`, `401` sans jeton et `502` quand TMDB refuse le jeton. Un test de fumée le rejoue à chaque exécution de la suite, et le routage a été simulé de bout en bout, y compris le cas où le proxy ne retire pas le préfixe.

## Avant de commencer

| Prérequis | État |
|---|---|
| Runbook, phases 0 à 5 | tunnel `nspace-tunnel` monté, 4 connexions edge |
| Dépôt GitHub | fait — `t3hx/owlog-app`, privé |
| Jeton TMDB dans Doppler | fait — `TMDB_API_TOKEN`, mais **dans `dev` seulement** |
| Quatre variables dans la config `prd` | **à faire** — §1 |
| Published route dans le tunnel | **à faire** — §2 |

## 1. Secrets

La config `prd` est **vide** : `TMDB_API_KEY` et `TMDB_API_TOKEN` n'existent que dans `dev`.

```bash
# Le jeton TMDB, recopié depuis dev. C'est le seul vrai secret des quatre,
# et il ne quitte jamais owlog-api.
doppler secrets set TMDB_API_TOKEN="$(doppler secrets get TMDB_API_TOKEN --plain \
  --project owlog-app --config dev)" --project owlog-app --config prd

# Un jeton partagé, tiré au sort. Il n'est pas secret — il finit dans le
# bundle web, lisible par quiconque ouvre les outils de développement.
doppler secrets set OWLOG_SHARED_TOKEN="$(openssl rand -hex 24)" --project owlog-app --config prd

# Le préfixe sous lequel le service se monte lui-même.
doppler secrets set OWLOG_BASE_PATH="/api" --project owlog-app --config prd

# Les réseaux internes de Docker. Voir ci-dessous : ce sont des plages.
doppler secrets set OWLOG_TRUSTED_PROXIES="10.0.0.0/8,172.16.0.0/12" --project owlog-app --config prd
```

`OWLOG_ALLOWED_ORIGINS` reste **vide** : même origine, donc aucun CORS. Le middleware ne se monte pas quand la liste est vide, ce qui est le comportement voulu.

### Comment ces valeurs arrivent sur le VPS

**Par un copier-coller, et il n'y a pas de magie derrière.** Dokploy n'a aucune intégration avec un gestionnaire de secrets externe — c'est une demande de fonctionnalité ouverte, pas une fonction existante. Doppler n'est donc pas *injecté* en production : il est le **registre**, l'endroit où l'on sait ce que valent ces variables et depuis lequel on les recopie.

Une commande produit le bloc prêt à coller dans l'onglet **Environment** de `owlog-api`, qui accepte le format `.env` :

```bash
doppler secrets download --no-file --format env --project owlog-app --config prd
```

Deux choses à savoir, et elles ne sont pas anodines :

- **Dokploy stocke ses variables en clair dans sa base.** Le jeton TMDB vivra donc en clair sur le VPS. C'est acceptable ici parce que le serveur est verrouillé — aucun port entrant, admin par Tailscale uniquement — mais ce n'est pas la même chose que « géré par Doppler ».
- **Un écart devient possible.** Modifier une valeur dans Doppler ne change rien en ligne tant qu'on n'a pas recollé et redéployé. Doppler cesse d'être la vérité au moment où on l'oublie.

Sur quatre variables, une seule est un vrai secret — `TMDB_API_TOKEN`. `OWLOG_SHARED_TOKEN` est public par construction, `OWLOG_BASE_PATH` et `OWLOG_TRUSTED_PROXIES` sont de la configuration. C'est ce qui rend le copier-coller raisonnable ici.

> **L'alternative, et pourquoi elle n'est pas retenue.** On pourrait installer le client Doppler dans l'image et démarrer par `doppler run -- node …`, en ne posant qu'un `DOPPLER_TOKEN` dans Dokploy. Doppler redeviendrait autoritatif — mais ce jeton de service, lui aussi en clair dans la base de Dokploy, ouvre l'accès à **tous** les secrets du projet. On échangerait quatre valeurs de faible portée contre une de portée maximale, plus un appel réseau à chaque démarrage de conteneur : Doppler injoignable, le service ne démarre plus. Le calcul ne penche pas du bon côté pour une application à un seul utilisateur.

### Pourquoi le service se monte lui-même sous `/api`

Le montage aurait pu reposer sur un « Strip Path » du proxy. Le runbook n'en mentionne aucun, et une hypothèse sur l'infrastructure ne se vérifie qu'après un cycle de déploiement complet — pour un échec qui ressemble à un problème de routage alors qu'il n'en est pas un.

`owlog-api` décale donc toutes ses routes lui-même, sonde de vie comprise. Il répond juste que le préfixe soit retiré ou non. Corollaire à connaître : **`/health` à la racine renvoie `404`**, c'est normal, la sonde est `/api/health`. Le `HEALTHCHECK` du Dockerfile suit la variable ; figé à la racine, il déclarerait le conteneur mort et Dokploy le redémarrerait en boucle.

### Pourquoi des plages et non des adresses

`owlog-api` ne voit jamais l'adresse du visiteur : il voit celle de Traefik, sur `dokploy-network`. Sans liste de confiance, il refuse tout en-tête d'IP et compte **tout le monde dans le même seau** — le premier utilisateur qui dépasse coupe le service pour tous.

Or cette adresse est attribuée par Docker et change quand le proxy est recréé. Une adresse exacte serait juste le jour du déploiement et fausse ensuite, sans que rien ne le signale. `10.0.0.0/8` couvre l'overlay Swarm de Dokploy (§4.4 du runbook : `10.254.0.0/24`), `172.16.0.0/12` les réseaux bridge. À confirmer sur le serveur :

```bash
docker network inspect dokploy-network | grep Subnet
```

`CF-Connecting-IP` est préféré dès que la liste est non vide. Dans cette architecture, la valeur est **structurellement fiable** : l'origine n'est joignable par aucun autre chemin que le tunnel, donc personne ne peut poser l'en-tête lui-même en contournant Cloudflare. C'est un bénéfice direct du verrouillage réseau du runbook, qu'un montage par enregistrement `A` n'offrirait pas.

## 2. Exposition — une published route, pas un enregistrement DNS

**Ne crée aucun enregistrement DNS à la main.** Le `CNAME` vers le tunnel est créé automatiquement.

Cloudflare → **Zero Trust → Networks → Connectors → `nspace-tunnel` → Configure → Published application routes → Add** :

| Champ | Valeur |
|---|---|
| Subdomain | `owlog` |
| Domain | `nspace.link` |
| Path | *(vide)* |
| Type | `HTTP` |
| URL | `dokploy-traefik:80` |

**Une seule route pour les deux services**, et c'est important. Elle amène tout `owlog.nspace.link` jusqu'à Traefik, qui répartit ensuite sur l'en-tête `Host` et le chemin. Le découpage `/` contre `/api` se fait **dans Dokploy**, par les domaines des deux services — pas dans Cloudflare.

Ajouter une seconde route pour `/api` n'apporte rien et peut tout casser : les routes du tunnel sont évaluées dans l'ordre, et une entrée mal placée ou dont l'URL de service est fausse détourne aussi le trafic de la première. Le symptôme est un `502` sur **tout le domaine**, y compris les chemins qui fonctionnaient.

Si ça arrive, la remise en état est de revenir à une seule entrée pointant sur `http://dokploy-traefik:80`, puis de vérifier depuis le VPS que le chemin est bon :

```bash
docker logs --tail 50 $(docker ps -q --filter name=cloudflared)
docker run --rm --network dokploy-network curlimages/curl -sI http://dokploy-traefik:80
```

Une réponse HTTP, même un `404`, prouve que cloudflared atteint Traefik. Un `Could not resolve host` désigne le réseau, pas la route.

Le nuage sera orange, et c'est normal : les `CNAME` de tunnel sont obligatoirement proxifiés.

## 3. Service `owlog-api`

Dashboard → **Projects** → `owlog` (à créer) → environnement **Production** → **Create Service** → **Application**.

Crée-le **en premier** : il se teste seul, alors que le web dépend de lui.

| Réglage Dokploy | Valeur |
|---|---|
| Source | GitHub, `t3hx/owlog-app`, branche `main` |
| Build Type | `Dockerfile` |
| Docker File | `apps/api/Dockerfile` |
| Docker Context Path | `.` — **la racine du dépôt** |

Le contexte de build est la racine et non `apps/api` : c'est un workspace pnpm, le lockfile et `@owlog/contracts` vivent à la racine. Un contexte sur `apps/api` échoue à l'installation.

**Environment** — colle le bloc rendu par `doppler secrets download` (§1), puis ajoute `PORT` :

```
TMDB_API_TOKEN="..."
OWLOG_SHARED_TOKEN="..."
OWLOG_BASE_PATH="/api"
OWLOG_TRUSTED_PROXIES="10.0.0.0/8,172.16.0.0/12"
PORT=8787
```

`DOPPLER_PROJECT`, `DOPPLER_CONFIG` et `DOPPLER_ENVIRONMENT` figurent aussi dans l'export : ils sont sans effet ici, on peut les laisser ou les retirer.

**Domains → Create :**

| Champ | Valeur |
|---|---|
| Host | `owlog.nspace.link` |
| Path | `/api` |
| Container Port | `8787` |
| HTTPS | **désactivé** |
| Certificate Provider | **None** |

Puis **Deploy**.

> Dokploy affichera un avertissement du type « le domaine ne pointe pas vers l'IP du serveur ». **Ignore-le** : le `CNAME` résout vers des IP Cloudflare, la comparaison ne matchera jamais. Traefik route sur l'en-tête `Host`, il ne consulte pas le DNS. Ce désaccord n'aurait de conséquence que pour un challenge HTTP-01, qu'on n'utilise nulle part.

**Vérification, avant de toucher au web :**

```bash
curl https://owlog.nspace.link/api/health
# {"status":"ok"}
# 404 ici  ->  le domaine ou OWLOG_BASE_PATH ne concordent pas.
# 502/530  ->  le conteneur ne répond pas, ou le tunnel est dégradé :
#              vérifie les 4 connexions edge de cloudflared.

curl -o /dev/null -w "%{http_code}\n" "https://owlog.nspace.link/api/search?q=dune"
# 401 — sans jeton, c'est le comportement attendu

curl -s -H "x-owlog-token: <OWLOG_SHARED_TOKEN>" \
  "https://owlog.nspace.link/api/search?q=dune" | head -c 200
# la liste des résultats — un 502 ici, c'est TMDB qui refuse le jeton.
```

## 4. Service `owlog-web`

Même projet, même environnement → **Create Service** → **Application**.

| Réglage Dokploy | Valeur |
|---|---|
| Source | GitHub, `t3hx/owlog-app`, branche `main` |
| Build Type | `Dockerfile` |
| Docker File | `apps/web/Dockerfile` |
| Docker Context Path | `.` — **la racine du dépôt** |

**Build Time Arguments** — des *arguments*, pas des variables d'exécution : ils sont figés dans le bundle au moment du build, et n'existent plus dans le conteneur qui tourne.

Ils se saisissent dans l'onglet **Environment**, dans le champ **« Build Time Arguments »** — distinct du champ des variables d'environnement, juste au-dessous. Il n'apparaît **que si le Build Type est `Dockerfile`** : si tu ne le vois pas, c'est que le type de build n'est pas encore réglé.

```
VITE_API_URL=/api
VITE_SHARED_TOKEN=<la même valeur que OWLOG_SHARED_TOKEN, recopiée depuis Doppler>
```

**Les oublier fait échouer le build**, volontairement. Un `ARG` Docker non fourni vaut la chaîne vide et non « absent » : le repli du code ne se déclenche pas, et le bundle sort avec une base d'API vide. Il appelle alors `/search` au lieu de `/api/search`, Caddy répond `index.html` avec un `200`, et l'application échoue à lire du HTML comme du JSON. Tout paraît fonctionner jusqu'à la première frappe dans la barre de recherche. Une image est un artefact de production : mieux vaut ne pas la construire que la construire fausse et muette.

Changer `OWLOG_SHARED_TOKEN` demande donc de **reconstruire** `owlog-web`, pas seulement de le redémarrer — et de le reconstruire *après* l'API, sinon le client envoie l'ancien jeton et récolte des `401`.

**Vérifier ce que le bundle appelle réellement**, une fois déployé :

```bash
JS=$(curl -s https://owlog.nspace.link/ | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
curl -s "https://owlog.nspace.link$JS" | grep -oE '"/api"' | head -1
# "/api"  attendu. Rien ici veut dire que les Build Args n'ont pas ete pris.
```

**Domains → Create :**

| Champ | Valeur |
|---|---|
| Host | `owlog.nspace.link` |
| Path | `/` |
| Container Port | `80` |
| HTTPS | **désactivé** |
| Certificate Provider | **None** |

Les deux services partagent le même hôte. Traefik classe ses règles par spécificité : `Host(...) && PathPrefix(/api)` l'emporte sur `Host(...)`. Aucun réglage de priorité à poser à la main.

## 5. Après la première mise en ligne

Dérouler [`CHECKLIST.md`](CHECKLIST.md) sur un téléphone réel. Les six parcours sont testables — les deux derniers, sur la file hors-ligne, sont arrivés avec l'étape 4.

Le service worker exige un contexte sécurisé : c'est Cloudflare qui le fournit, l'origine parlant HTTP en clair. L'installation depuis l'écran d'accueil ne marchera donc que par le domaine public, jamais par une IP tailnet en HTTP.

## 6. Le piège à vérifier en premier

Déployer une **seconde** fois, puis vérifier qu'un client déjà ouvert voit le bandeau au retour au premier plan, et que le rechargement sert la nouvelle version **sans vider le cache**.

C'est le défaut le plus coûteux de cette étape, et il est silencieux : sans `Cache-Control: no-cache` sur `index.html` et sur `sw.js`, le navigateur garde l'ancien document, qui référence l'ancien bundle. L'application marche parfaitement — elle est simplement périmée, indéfiniment. Le `Caddyfile` pose ces en-têtes ; ce test vérifie qu'ils traversent Cloudflare, qui applique ses propres règles.

```bash
curl -sI https://owlog.nspace.link/ | grep -i "cache-control\|cf-cache-status"
# cache-control: no-cache        <- attendu
curl -sI https://owlog.nspace.link/sw.js | grep -i "cache-control"
# cache-control: no-cache        <- attendu
```

Si Cloudflare les écrase, créer une règle de cache qui contourne `/`, `/index.html`, `/sw.js`, `/registerSW.js` et `/manifest.webmanifest`.

## 7. Passage de `dev` à `main`

```bash
git switch main
git merge --no-ff dev -m "Deploiement: etapes 1 a 4"
git push origin main
```

Dokploy déclenche les deux builds sur `main`. `git log main` répond alors à la question « qu'est-ce qui tourne en ligne, maintenant ? », ce qui est le seul rôle de cette branche.

## Corriger ce document

La partie Dokploy n'a pas encore été exécutée. **Au premier passage, corrige-la dans le même commit** que le déploiement : un document de mise en ligne faux coûte plus cher que pas de document, parce qu'on lui fait confiance à trois heures du matin.
