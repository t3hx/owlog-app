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
| Jeton TMDB dans Doppler | fait — `TMDB_API_TOKEN`, dans `dev` et dans `prd` |
| Secrets dans la config `prd` | §1 |
| Jeton de service `prd` pour Dokploy | §1 |
| Jeton de service `prd` pour GitHub Actions | §4 bis |
| Published route dans le tunnel | §2 |

## 1. Secrets

**Doppler est la table de vérité, et il l'est mécaniquement.** Aucun secret de production n'est recopié nulle part : `owlog-api` va les lire lui-même au démarrage du conteneur. Dokploy ne détient plus qu'un jeton de service — scopé à `prd`, en lecture seule, révocable d'une commande.

Ce n'était pas le cas auparavant : les valeurs étaient collées à la main dans l'onglet Environment de Dokploy, et Doppler n'était la vérité que par discipline. Une valeur changée dans le coffre ne changeait rien en ligne, et rien ne signalait l'écart.

### Ce que contient la config `prd`

```bash
doppler secrets set TMDB_API_TOKEN="$(doppler secrets get TMDB_API_TOKEN --plain \
  --project owlog-app --config dev)" --project owlog-app --config prd

# Public par construction : il finit dans le bundle web, lisible par
# quiconque ouvre les outils de développement. Il filtre le bruit, il ne
# protège rien.
doppler secrets set OWLOG_SHARED_TOKEN="$(openssl rand -hex 24)" --project owlog-app --config prd

# Les réseaux internes de Docker. Voir plus bas : ce sont des plages.
doppler secrets set OWLOG_TRUSTED_PROXIES="10.0.0.0/8,172.16.0.0/12" --project owlog-app --config prd
```

`OWLOG_ALLOWED_ORIGINS` reste **absente** : même origine, donc aucun CORS. Le middleware ne se monte pas quand la liste est vide, ce qui est le comportement voulu.

`OWLOG_BASE_PATH` **n'est plus dans Doppler** et doit en être retirée si elle y traîne :

```bash
doppler secrets delete OWLOG_BASE_PATH --project owlog-app --config prd
```

Ce n'est pas un secret mais la topologie de montage du service, et elle vit désormais en `ENV` dans `apps/api/Dockerfile`. La raison est concrète : le `HEALTHCHECK` de l'image s'exécute dans un processus séparé, qui ne passe pas par `doppler run` et **ne voit donc aucune variable injectée par Doppler**. Laissée dans le coffre, elle donnerait une sonde qui interroge `/health` pendant que le service écoute sur `/api/health` — conteneur déclaré mort alors qu'il sert parfaitement, et retour arrière automatique de Dokploy.

### Le jeton de service

À créer une fois. `--copy` le met dans le presse-papier plutôt qu'à l'écran, où il finirait dans l'historique du shell :

```bash
doppler configs tokens create dokploy-owlog-api \
  --project owlog-app --config prd --access read --copy
```

`--access read` est le défaut, écrit ici pour être explicite : **ce jeton ne peut rien modifier**. Il ne voit pas la config `dev`, ni aucun autre projet Doppler.

Il se colle ensuite dans l'onglet **Environment** de `owlog-api` (§3). C'est la seule chose que Dokploy détient.

### Ce que ça change en cas de fuite

Dokploy stocke ses variables en clair dans sa base — c'était vrai avant, ça l'est toujours. La différence est dans ce qui s'y trouve : un pointeur révocable au lieu des secrets eux-mêmes.

| | Avant | Maintenant |
|---|---|---|
| Contenu de la base Dokploy | jeton TMDB, URL Postgres, jeton Resend | un jeton de service `prd`, lecture seule |
| Remédiation après fuite | rotation chez TMDB, Postgres **et** Resend | `doppler configs tokens revoke`, une commande |
| Changer un secret | éditer Doppler, recoller dans Dokploy, redéployer | éditer Doppler, redémarrer le conteneur |

Le risque que ce montage **ajoute**, et qu'il faut connaître : le conteneur détient un identifiant vivant. Une exécution de code arbitraire dans `owlog-api` donnait auparavant les secrets présents dans l'environnement — un butin figé ; elle donne désormais en plus la capacité d'interroger Doppler à nouveau, depuis ailleurs. Le jeton étant en lecture seule et scopé à `prd`, l'attaquant n'obtient rien de plus que ce que le conteneur détenait déjà, mais il l'obtient de façon durable. `--max-age` sur le jeton borne cette fenêtre si le compromis ne convient pas.

### Si Doppler est en panne

Le conteneur démarre quand même — dans un cas sur deux, et il faut savoir lequel.

`docker-entrypoint.sh` lance `doppler run --fallback`, qui écrit un instantané **chiffré** des secrets à chaque lecture réussie et le relit quand l'API est injoignable. Vérifié en conditions réelles : conteneur relancé avec `--network none`, journal `Reading secrets from fallback file`, service opérationnel.

- **Redémarrage** d'un conteneur existant — crash, reboot du VPS, `docker restart` : le repli est là, le service repart. ✅
- **Nouveau déploiement** pendant la panne : le conteneur est neuf, son système de fichiers est vierge, il n'a aucun repli et ne démarre pas. ❌

Monter un volume Dokploy sur `/home/node` fait survivre le repli aux déploiements et couvre aussi le second cas. Ce n'est pas le défaut : cela laisse un fichier de secrets chiffrés en permanence sur le disque du VPS, pour un gain qui ne joue que dans la fenêtre étroite « Doppler en panne **et** déploiement au même moment ».

> **L'alternative, et pourquoi elle n'est pas retenue.** On pourrait faire lire Doppler par la CI, qui pousserait ensuite les valeurs dans Dokploy via son API avant de déclencher le déploiement. Doppler resterait autoritatif sans que l'image apprenne son existence, et sans appel réseau au démarrage. Deux raisons de ne pas le faire : les secrets continueraient de vivre en clair dans la base Dokploy, ce que ce changement vise précisément à supprimer ; et le montage dépendrait d'un endpoint d'écriture de Dokploy que rien dans le runbook ne documente — une pièce dont on ne découvre le comportement qu'après un cycle de déploiement complet.
>
> Ce document a longtemps affirmé l'inverse, sur deux arguments qui se sont révélés faux à la vérification : un jeton de service Doppler n'ouvre **pas** l'accès à tous les secrets du projet — `doppler configs tokens create` prend `--config` et `--access read` par défaut — et une panne de Doppler n'empêche **pas** le service de démarrer, `--fallback` couvrant le cas.

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

**Environment** — deux lignes, et c'est tout :

```
DOPPLER_TOKEN=dp.st.prd....
PORT=8787
```

Le jeton est celui créé au §1. Tout le reste — jeton TMDB, jeton partagé, plages de proxies, `DATABASE_URL`, secrets e-mail — est lu chez Doppler au démarrage du conteneur et ne doit **pas** figurer ici. Une valeur posée dans ce panneau serait écrasée par celle de Doppler à chaque lecture, ce qui donne le pire des cas : un réglage visible qui ne s'applique pas.

`PORT` reste une variable Dokploy : elle décrit l'écoute du conteneur, pas un secret, et l'image la fixe déjà à `8787`.

La première ligne du journal dit quel mode a été retenu, et c'est la première chose à lire devant un incident :

```
owlog-api: starting through Doppler
owlog-api listening on :8787, routes mounted at /api, db off
```

`starting without Doppler (environment as provided)` à la place signifie que `DOPPLER_TOKEN` est absent ou vide. Le service tentera alors de démarrer sur les variables du panneau et, n'y trouvant ni `TMDB_API_TOKEN` ni `OWLOG_SHARED_TOKEN`, mourra en nommant celle qui manque — un échec bruyant, jamais un service à moitié configuré.

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
VITE_SHARED_TOKEN=<la même valeur que OWLOG_SHARED_TOKEN dans Doppler prd>
```

> **Ces deux champs ne servent que si Dokploy construit lui-même l'image.** Dans le circuit nominal, c'est `deploy.yml` qui construit et pousse sur GHCR, et il lit `OWLOG_SHARED_TOKEN` **directement dans Doppler `prd`** — plus aucune valeur à recopier à la main. Voir §4 bis.

**Les oublier fait échouer le build**, volontairement. Un `ARG` Docker non fourni vaut la chaîne vide et non « absent » : le repli du code ne se déclenche pas, et le bundle sort avec une base d'API vide. Il appelle alors `/search` au lieu de `/api/search`, Caddy répond `index.html` avec un `200`, et l'application échoue à lire du HTML comme du JSON. Tout paraît fonctionner jusqu'à la première frappe dans la barre de recherche. Une image est un artefact de production : mieux vaut ne pas la construire que la construire fausse et muette.

Changer `OWLOG_SHARED_TOKEN` demande donc de **reconstruire** `owlog-web`, pas seulement de le redémarrer — et de le reconstruire *après* l'API, sinon le client envoie l'ancien jeton et récolte des `401`.

### 4 bis. Ce que la CI lit dans Doppler

Le bundle web est le seul artefact qui a besoin d'un secret **au moment du build** : `VITE_SHARED_TOKEN` est figé dedans, il ne peut pas être lu au démarrage comme le fait `owlog-api`. `deploy.yml` va donc le chercher dans Doppler `prd` avant de construire l'image.

Un secret GitHub à créer une fois, `DOPPLER_TOKEN_PRD` :

```bash
doppler configs tokens create github-actions-owlog \
  --project owlog-app --config prd --access read --copy
```

puis **Settings → Secrets and variables → Actions → New repository secret**, nom `DOPPLER_TOKEN_PRD`.

Le secret `OWLOG_SHARED_TOKEN` côté GitHub **devient inutile et doit être supprimé**. Il était une seconde source de vérité pour une valeur qui doit être identique à celle du service : rien n'imposait leur égalité, et leur divergence ne se voit pas au build. Elle donne un bundle qui se charge, s'affiche, navigue — et répond `401` à la première frappe dans la recherche.

Ce jeton-ci est distinct de celui de Dokploy, bien que tous deux lisent `prd` : deux consommateurs, deux jetons, deux révocations indépendantes. Un incident sur les runners GitHub ne doit pas obliger à toucher au service en ligne.

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

## 8. Postgres et sauvegarde (temps 2)

Postgres arrive comme service Dokploy sur `dokploy-network`, jamais exposé. Le secret `DATABASE_URL` (Doppler) le fait connaître d'`owlog-api` — qui **démarre et vit sans lui** : sans `DATABASE_URL`, ou avec la base down, `/api/health` répond `200` avec `db: off|down` dans le corps, `/api/sync/*` répond `503`, et le proxy TMDB continue. Les migrations s'appliquent toutes seules au démarrage du service, sous advisory lock ; il n'y a aucune étape de migration manuelle.

La sonde Dokploy reste sur `/api/health` : elle est une liveness **sans ping de la base**, à dessein — une sonde qui dépendrait de Postgres transformerait toute panne de base en redémarrage en boucle de l'API.

### Sauvegarde quotidienne — obligatoire, pas optionnelle

Un Postgres non sauvegardé serait un recul de durabilité par rapport au `.log` manuel. Sur le VPS :

```bash
sudo apt install postgresql-client age rclone   # une fois
age-keygen -o owlog-backup-identity.txt         # une fois, PUIS SORTIR LA CLÉ DU VPS
# la clé privée se garde hors du VPS (gestionnaire de mots de passe) ;
# seul le destinataire public age1… reste dans l'environnement du cron.
```

Cron quotidien (l'utilisateur du VPS, pas root) :

```cron
0 2 * * * DATABASE_URL=postgres://… OWLOG_BACKUP_AGE_RECIPIENT=age1… \
  OWLOG_BACKUP_RCLONE_REMOTE=r2:owlog-backups \
  /chemin/owlog-app/scripts/db-backup.sh >> /var/log/owlog-backup.log 2>&1
```

Le script exclut les **données** d'`auth_tokens` (des secrets en vol, TTL 15 min), chiffre le flux avant qu'il touche le disque, garde 14 dumps localement et pousse le reste vers l'object storage.

### Restauration

```bash
# une base cible VIERGE, puis :
OWLOG_BACKUP_AGE_IDENTITY=owlog-backup-identity.txt \
  ./scripts/db-restore.sh owlog-<date>.sql.gz.age postgres://…/owlog_restored
```

La procédure a été exécutée de bout en bout le 2026-07-30 (source peuplée → dump chiffré → base vierge → comptes identiques, `auth_tokens` vide, trigger append-only actif). **La rejouer après la première sauvegarde de production** : une sauvegarde jamais restaurée n'est pas une sauvegarde.

## 9. Secrets e-mail et leur rotation (temps 2)

Trois variables Doppler côté `owlog-api`, toutes optionnelles — sans elles,
le mailer console prend le relais et les e-mails de connexion s'écrivent
dans les journaux du conteneur, ce qui suffit en développement et en
dépannage :

| Nom | Rôle |
|---|---|
| `OWLOG_EMAIL_API_TOKEN` | jeton du fournisseur — LE secret à protéger |
| `OWLOG_EMAIL_API_URL` | endpoint du fournisseur (défaut : Resend) |
| `OWLOG_EMAIL_FROM` | expéditeur, `Owlog <no-reply@…>` |

### Rotation du jeton

À faire **au moindre doute** (jeton aperçu dans un log, un écran partagé,
un dépôt), et par hygiène à chaque changement de fournisseur :

1. Créer le nouveau jeton chez le fournisseur — **avant** de révoquer
   l'ancien : les deux coexistent, aucun trou de service.
2. `doppler secrets set OWLOG_EMAIL_API_TOKEN --project owlog-app --config prd`
3. **Redémarrer** `owlog-api` — un simple restart suffit, le conteneur relit
   Doppler au démarrage. Il n'y a plus rien à recopier dans Dokploy ni de
   déploiement à déclencher, et c'est vrai de tout secret d'exécution.
   Seul `OWLOG_SHARED_TOKEN` fait exception : il est figé dans le bundle web
   au build, donc son changement impose de reconstruire `owlog-web`.
4. Demander un lien de connexion réel et vérifier la réception.
5. Révoquer l'ancien jeton chez le fournisseur — en dernier.

En cas de compromission avérée, inverser 1 et 5 : révoquer d'abord, et
accepter la fenêtre où `request-link` répond 502 (`upstream-unavailable`) —
l'app locale continue de fonctionner, seule la connexion attend.

Le jeton n'apparaît jamais dans le bundle web : `local-prod.sh check` le
vérifie mécaniquement (« aucun secret e-mail dans le bundle »).

## Corriger ce document

La partie Dokploy n'a pas encore été exécutée. **Au premier passage, corrige-la dans le même commit** que le déploiement : un document de mise en ligne faux coûte plus cher que pas de document, parce qu'on lui fait confiance à trois heures du matin.
