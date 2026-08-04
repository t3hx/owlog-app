#!/usr/bin/env bash
#
# Pile de production, en local.
#
# `pnpm dev` ne prouve rien de ce qui casse en mise en ligne. Le serveur de
# développement sert des modules non groupés, sans service worker, sans Caddy
# et sans préfixe de montage — c'est-à-dire sans aucune des pièces qui ont
# produit les pannes de déploiement de ce projet. Ce script construit les
# vraies images et les fait tourner dans la vraie topologie : une seule
# origine, `owlog-web` à la racine, `owlog-api` sous `/api`.
#
#   ./scripts/local-prod.sh up       construit et démarre, sur :8080
#   ./scripts/local-prod.sh down     arrête et supprime tout
#   ./scripts/local-prod.sh logs     suit les journaux des trois conteneurs
#   ./scripts/local-prod.sh check    rejoue les vérifications de mise en ligne
#
# Le jeton TMDB vient de Doppler, jamais d'un fichier. Il n'entre pas dans le
# bundle web : seul `owlog-api` le reçoit.

set -euo pipefail

readonly NETWORK=owlog-local
readonly PORT=8080
readonly SHARED_TOKEN=local-token
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

readonly API_IMAGE=owlog-api:local
readonly WEB_IMAGE=owlog-web:local
readonly EDGE_IMAGE=owlog-edge:local

readonly API_NAME=owlog-api
readonly WEB_NAME=owlog-web
readonly EDGE_NAME=owlog-edge

# Postgres local, comme en production : sans lui, /auth et /sync répondent
# 503 et le check ne peut pas rejouer leurs pièges. Le mot de passe est
# local et jetable — la base meurt avec la pile.
# La majeure de la production. Ce script existe pour reproduire la mise en
# ligne : sur une autre majeure, il simulerait une prod qui n'existe pas.
readonly PG_IMAGE=postgres:18-alpine
readonly PG_NAME=owlog-pg-local
readonly PG_PASSWORD=owlog-local

# --- Garde-fous -------------------------------------------------------------

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 est requis et introuvable." >&2
    exit 1
  }
}

# L'appartenance au groupe `docker` ne prend effet qu'à la session suivante.
# Un shell ouvert avant le `usermod` continue de se voir refuser le socket, et
# le message brut de Docker ne dit pas pourquoi — on croit à un daemon éteint.
check_docker() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  if id -nG | tr ' ' '\n' | grep -qx docker; then
    echo "Le daemon Docker refuse la connexion alors que le groupe est bon." >&2
    echo "Le daemon est-il démarré ? sudo systemctl start docker" >&2
  elif getent group docker | grep -q "\b$(id -un)\b"; then
    echo "Vous êtes dans le groupe docker, mais ce shell ne le voit pas encore :" >&2
    echo "un changement de groupe ne vaut qu'à la session suivante." >&2
    echo "Relancez ce script via :  sg docker -c '$0 ${1:-up}'" >&2
  else
    echo "Vous n'êtes pas dans le groupe docker." >&2
    echo "  sudo usermod -aG docker \$USER   puis reconnectez-vous" >&2
  fi
  exit 1
}

# Le jeton TMDB vient de la config `dev` — jamais de `prd`. Rejouer la vraie
# topologie ne demande pas les vrais secrets : ce script vérifie du routage,
# des en-têtes et du service worker, et un jeton de développement suffit à
# tout cela.
#
# Le couple projet/config n'est plus écrit ici : il vit dans `doppler.yaml`,
# et `doppler setup` l'applique. Le répéter dans chaque appel en ferait une
# troisième copie à maintenir en phase — c'est exactement la divergence que
# ce fichier épinglé supprime.
tmdb_token_from_doppler() {
  require doppler
  doppler setup --no-interactive >/dev/null
  doppler secrets get TMDB_API_TOKEN --plain
}

# --- Commandes --------------------------------------------------------------

up() {
  local tmdb_token
  tmdb_token="$(tmdb_token_from_doppler)"

  echo "▸ construction des images"
  docker build -q -f "$ROOT/apps/api/Dockerfile" -t "$API_IMAGE" "$ROOT" >/dev/null
  # Les deux arguments sont obligatoires : sans eux le bundle sort avec une
  # base d'API vide, appelle `/search` au lieu de `/api/search`, et tout
  # marche jusqu'à la première frappe dans la recherche. Le Dockerfile refuse
  # de se construire s'ils manquent — ce script ne fait que les fournir.
  docker build -q -f "$ROOT/apps/web/Dockerfile" \
    --build-arg VITE_API_URL=/api \
    --build-arg VITE_SHARED_TOKEN="$SHARED_TOKEN" \
    -t "$WEB_IMAGE" "$ROOT" >/dev/null
  docker build -q -t "$EDGE_IMAGE" "$ROOT/scripts/local-prod" >/dev/null

  down_quietly

  echo "▸ démarrage"
  docker network create "$NETWORK" >/dev/null

  local subnet
  subnet="$(docker network inspect "$NETWORK" --format '{{(index .IPAM.Config 0).Subnet}}')"

  # Postgres démarre en premier : l'API migre au boot sous advisory lock,
  # exactement le chemin de la production. Si la base traîne, l'API
  # réessaie — c'est un cas nominal de déploiement, testé tel quel.
  docker run -d --name "$PG_NAME" --network "$NETWORK" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB=owlog \
    "$PG_IMAGE" >/dev/null

  # `OWLOG_TRUSTED_PROXIES` porte le sous-réseau et non `0.0.0.0/0` : la
  # limitation de débit doit compter par IP réelle, comme en production. Tout
  # faire confiance masquerait un défaut de configuration au lieu de le
  # révéler ici, là où il est réparable.
  #
  # Pas de secrets e-mail : le mailer console prend le relais, et les
  # e-mails de connexion se lisent dans `logs` — suffisant pour rejouer le
  # parcours complet en local.
  docker run -d --name "$API_NAME" --network "$NETWORK" \
    -e TMDB_API_TOKEN="$tmdb_token" \
    -e OWLOG_SHARED_TOKEN="$SHARED_TOKEN" \
    -e OWLOG_BASE_PATH=/api \
    -e OWLOG_TRUSTED_PROXIES="$subnet" \
    -e DATABASE_URL="postgresql://postgres:$PG_PASSWORD@$PG_NAME:5432/owlog" \
    -e OWLOG_PUBLIC_ORIGIN="http://localhost:$PORT" \
    "$API_IMAGE" >/dev/null

  docker run -d --name "$WEB_NAME" --network "$NETWORK" "$WEB_IMAGE" >/dev/null

  docker run -d --name "$EDGE_NAME" --network "$NETWORK" \
    -p "$PORT:80" "$EDGE_IMAGE" >/dev/null

  wait_healthy
  echo
  echo "  http://localhost:$PORT"
  echo
  docker ps --filter "name=owlog-" --format '  {{.Names}}\t{{.Status}}'
}

wait_healthy() {
  printf '▸ attente des sondes de vie'
  # La base compte aussi : tant que les migrations n'ont pas réussi, /auth
  # et /sync répondent 503 et le check échouerait pour de mauvaises raisons.
  for _ in $(seq 1 45); do
    if curl -sf "http://localhost:$PORT/api/health" 2>/dev/null | grep -q '"db":"ok"' &&
      curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
      printf ' ok\n'
      return
    fi
    printf '.'
    sleep 1
  done
  printf '\n'
  echo "Les sondes ne répondent pas. Journaux :  $0 logs" >&2
  exit 1
}

down_quietly() {
  docker rm -f "$EDGE_NAME" "$WEB_NAME" "$API_NAME" "$PG_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}

down() {
  down_quietly
  echo "▸ pile arrêtée"
}

refresh() {
  if ! docker ps --format '{{.Names}}' | grep -q "^$PG_NAME$"; then
    echo "Postgres n'est pas démarré : rien à préserver, utilisez  $0 up" >&2
    exit 1
  fi

  local tmdb_token
  tmdb_token="$(tmdb_token_from_doppler)"

  echo "▸ reconstruction des images (la base est préservée)"
  docker build -q -f "$ROOT/apps/api/Dockerfile" -t "$API_IMAGE" "$ROOT" >/dev/null
  docker build -q -f "$ROOT/apps/web/Dockerfile" \
    --build-arg VITE_API_URL=/api \
    --build-arg VITE_SHARED_TOKEN="$SHARED_TOKEN" \
    -t "$WEB_IMAGE" "$ROOT" >/dev/null
  docker build -q -t "$EDGE_IMAGE" "$ROOT/scripts/local-prod" >/dev/null

  echo "▸ remplacement des services (Postgres intact)"
  docker rm -f "$API_NAME" "$WEB_NAME" "$EDGE_NAME" >/dev/null 2>&1 || true

  local subnet
  subnet="$(docker network inspect "$NETWORK" --format '{{(index .IPAM.Config 0).Subnet}}')"

  docker run -d --name "$API_NAME" --network "$NETWORK" \
    -e TMDB_API_TOKEN="$tmdb_token" \
    -e OWLOG_SHARED_TOKEN="$SHARED_TOKEN" \
    -e OWLOG_BASE_PATH=/api \
    -e OWLOG_TRUSTED_PROXIES="$subnet" \
    -e DATABASE_URL="postgresql://postgres:$PG_PASSWORD@$PG_NAME:5432/owlog" \
    -e OWLOG_PUBLIC_ORIGIN="http://localhost:$PORT" \
    "$API_IMAGE" >/dev/null

  docker run -d --name "$WEB_NAME" --network "$NETWORK" "$WEB_IMAGE" >/dev/null

  docker run -d --name "$EDGE_NAME" --network "$NETWORK" \
    -p "$PORT:80" "$EDGE_IMAGE" >/dev/null

  wait_healthy
  echo
  echo "  http://localhost:$PORT  (base préservée — accepter la bannière de mise à jour ou recharger)"
  echo
  docker ps --filter "name=owlog-" --format '  {{.Names}}\t{{.Status}}'
}

logs() {
  docker logs -f "$API_NAME" &
  docker logs -f "$WEB_NAME" &
  docker logs -f "$EDGE_NAME" &
  wait
}

# Rejoue les pièges connus de la mise en ligne. Ils sont invisibles en
# développement et chacun a déjà coûté un cycle de déploiement complet.
check() {
  local failures=0

  # `printf '%-42s'` compte les octets, pas les caractères : une étiquette
  # accentuée occupe plus d'octets que de colonnes et la sortie se désaligne.
  # `${#label}` compte bien les caractères en locale UTF-8, d'où ce calage à
  # la main.
  pad() {
    local width=$((42 - ${#1}))
    [ "$width" -gt 0 ] && printf '%*s' "$width" ''
  }

  expect() {
    local label="$1" expected="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
      printf '  ok    %s%s %s\n' "$label" "$(pad "$label")" "$actual"
    else
      printf '  ÉCHEC %s%s attendu %s, obtenu %s\n' \
        "$label" "$(pad "$label")" "$expected" "$actual"
      failures=$((failures + 1))
    fi
  }

  local base="http://localhost:$PORT"

  expect "l'application répond" 200 \
    "$(curl -s -o /dev/null -w '%{http_code}' "$base/")"

  # Le rewrite SPA : une route interne n'existe pas sur le disque.
  expect "une route interne sert index.html" 200 \
    "$(curl -s -o /dev/null -w '%{http_code}' "$base/library")"

  # Le retour d'un fournisseur OAuth est une entrée EXTERNE dans la SPA : le
  # navigateur y arrive par une redirection, à froid, sans passer par
  # l'application. Si la réécriture ne couvre pas ce chemin, la connexion par
  # Google casse en production et nulle part ailleurs — `pnpm dev` sert
  # toutes les routes, il ne peut pas révéler ce trou.
  expect "le retour d'un fournisseur sert l'app" 200 \
    "$(curl -s -o /dev/null -w '%{http_code}' "$base/login/oauth/google?code=x&state=y")"

  # Sans secrets de fournisseur, aucun bouton n'est offert. Ce n'est pas
  # qu'une préférence d'écran : la liste est servie par l'API, et une liste
  # non vide sans secrets signifierait qu'un bouton mène à une impasse.
  expect "les fournisseurs offerts sont ceux qui sont configurés" '"providers"' \
    "$(curl -s -H "x-owlog-token: $SHARED_TOKEN" "$base/api/auth/oauth/providers" | grep -o '"providers"')"

  # Sans `no-cache`, le navigateur garde l'ancien document, qui référence
  # l'ancien bundle : le déploiement n'atteint jamais les clients existants.
  expect "index.html n'est pas mis en cache" "no-cache" \
    "$(curl -sI "$base/" | grep -i '^cache-control' | tr -d '\r' | sed 's/.*: //')"

  expect "le service worker n'est pas mis en cache" "no-cache" \
    "$(curl -sI "$base/sw.js" | grep -i '^cache-control' | tr -d '\r' | sed 's/.*: //')"

  local asset
  asset="$(curl -s "$base/" | grep -oE '/assets/[^"]+\.js' | head -1)"
  expect "les assets hachés sont figés" "public, max-age=31536000, immutable" \
    "$(curl -sI "$base$asset" | grep -i '^cache-control' | tr -d '\r' | sed 's/.*: //')"

  # Le service se monte lui-même sous `/api` : la sonde suit le préfixe.
  # Le corps porte aussi l'état de la base (`db`), qui dépend de la
  # configuration de la pile — on ne fige que le statut du service.
  expect "la sonde de l'api suit son préfixe" '"status":"ok"' \
    "$(curl -s "$base/api/health" | grep -o '"status":"ok"')"

  # Sans la liste d'exclusion, une navigation vers /api affiche
  # l'application : curl répond juste, le navigateur ment, et on cherche la
  # panne du mauvais côté.
  expect "une navigation vers /api rend du JSON" '"status":"ok"' \
    "$(curl -s -H 'Accept: text/html' "$base/api/health" | grep -o '"status":"ok"')"

  # Le jeton TMDB ne doit jamais quitter owlog-api.
  local leaked
  leaked="$(curl -s "$base$asset" | grep -c 'eyJhbGciOi' || true)"
  expect "aucun jeton TMDB dans le bundle" 0 "$leaked"

  # Les secrets e-mail non plus : ils n'existent que côté API. Une variable
  # `OWLOG_EMAIL_*` qui fuirait dans le bundle serait un jeton Resend public.
  local mail_leak
  mail_leak="$(curl -s "$base$asset" | grep -c 'OWLOG_EMAIL' || true)"
  expect "aucun secret e-mail dans le bundle" 0 "$mail_leak"

  # La base est migrée et vivante : sans elle, /auth et /sync mentiraient
  # en 503 et les deux vérifications suivantes n'exerceraient rien.
  expect "la base est migrée au boot" '"db":"ok"' \
    "$(curl -s "$base/api/health" | grep -o '"db":"ok"')"

  # /auth valide ses entrées : un corps absent rend 400, pas un 500 ni un
  # e-mail fantôme.
  expect "auth refuse un corps absent" 400 \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      -H "x-owlog-token: $SHARED_TOKEN" "$base/api/auth/request-link")"

  # /sync exige une session : le jeton partagé (public) ne suffit jamais.
  expect "sync refuse sans session" 401 \
    "$(curl -s -o /dev/null -w '%{http_code}' \
      -H "x-owlog-token: $SHARED_TOKEN" "$base/api/sync/events")"

  echo
  if [ "$failures" -eq 0 ]; then
    echo "▸ toutes les vérifications passent"
  else
    echo "▸ $failures vérification(s) en échec" >&2
    exit 1
  fi
}

# --- Entrée -----------------------------------------------------------------

main() {
  local command="${1:-up}"

  require docker
  require curl

  case "$command" in
    up)
      check_docker up
      up
      ;;
    down)
      check_docker down
      down
      ;;
    refresh)
      check_docker refresh
      refresh
      ;;
    logs)
      check_docker logs
      logs
      ;;
    check)
      check
      ;;
    *)
      echo "usage: $0 [up|refresh|down|logs|check]" >&2
      exit 1
      ;;
  esac
}

main "$@"
