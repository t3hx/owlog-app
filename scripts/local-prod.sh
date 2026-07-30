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

# --- Commandes --------------------------------------------------------------

up() {
  local tmdb_token
  tmdb_token="$(doppler secrets get TMDB_API_TOKEN --project owlog-app --config dev --plain)"

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

  # `OWLOG_TRUSTED_PROXIES` porte le sous-réseau et non `0.0.0.0/0` : la
  # limitation de débit doit compter par IP réelle, comme en production. Tout
  # faire confiance masquerait un défaut de configuration au lieu de le
  # révéler ici, là où il est réparable.
  docker run -d --name "$API_NAME" --network "$NETWORK" \
    -e TMDB_API_TOKEN="$tmdb_token" \
    -e OWLOG_SHARED_TOKEN="$SHARED_TOKEN" \
    -e OWLOG_BASE_PATH=/api \
    -e OWLOG_TRUSTED_PROXIES="$subnet" \
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
  for _ in $(seq 1 30); do
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 &&
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
  docker rm -f "$EDGE_NAME" "$WEB_NAME" "$API_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}

down() {
  down_quietly
  echo "▸ pile arrêtée"
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
      require doppler
      check_docker up
      up
      ;;
    down)
      check_docker down
      down
      ;;
    logs)
      check_docker logs
      logs
      ;;
    check)
      check
      ;;
    *)
      echo "usage: $0 [up|down|logs|check]" >&2
      exit 1
      ;;
  esac
}

main "$@"
