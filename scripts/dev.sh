#!/usr/bin/env bash
#
# Developpement local : owlog-api et owlog-web ensemble, sous la topologie
# de la production.
#
#   pnpm dev            # ce script
#
# Pourquoi un script plutot qu'un `pnpm -r dev` : deux processus a lancer
# ensemble sous une seule origine — l'API relayee sous `/api` par le proxy du
# serveur de dev, aucun CORS, comme en ligne — et une valeur a faire traverser
# la frontiere Doppler -> Vite (voir plus bas). Les secrets, eux, viennent
# tous de la config `dev` de Doppler : ce script n'en connait plus aucun.
#
# Ce fut longtemps l'inverse. La config resolue etait `prd`, et le script
# neutralisait a la main les trois valeurs qui sont justes en production et
# fausses en local. Il etait le seul endroit a connaitre l'ecart, et l'ecart
# ne se voyait nulle part ailleurs. La config `dev` existe desormais et
# `doppler.yaml` l'epingle : l'ecart n'existe plus, donc le script ne le
# decrit plus.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v doppler > /dev/null 2>&1; then
  echo "doppler est introuvable. Les secrets du projet vivent dedans." >&2
  echo "  brew install dopplerhq/cli/doppler && doppler login" >&2
  exit 1
fi

# `doppler.yaml` DECLARE le couple projet/config ; seul `doppler setup` le
# POSE dans ~/.doppler, ou `doppler run` va le lire. Sans cette ligne, le
# fichier reste decoratif et la resolution retombe sur l'etat de la machine
# — c'est-a-dire, sur ce poste, sur `prd`. Idempotent : c'est une ecriture
# de la meme valeur a chaque lancement, pas une question posee.
doppler setup --no-interactive > /dev/null

# Sans ce nettoyage, un service laisse par une session precedente garde le
# port et le suivant meurt sur EADDRINUSE — message qui ne dit pas qu'il
# suffit de tuer l'ancien.
cleanup() {
  local status=$?
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2> /dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

# `OWLOG_BASE_PATH` n'est pas un secret : c'est la topologie de montage, la
# meme pour tout deploiement de ce service. Elle vit donc avec la definition
# du runtime — ici, `ENV` dans apps/api/Dockerfile la-bas — et non dans le
# coffre. `/api` parce que le proxy du serveur de dev relaie `/api` tel quel,
# exactement comme le fait le tunnel en production.
#
# Pas de `--watch` ici, bien que le drapeau existe et redemarrerait le
# service a chaque changement de secret : il echoue sur ce compte
# (« Unable to watch for secrets changes ») sans empecher le demarrage. Le
# service tourne, mais chaque lancement afficherait une erreur rouge qui ne
# decrit aucun probleme reel — et un faux signal d'alarme quotidien finit
# par masquer les vrais. Consequence a connaitre : faire tourner un secret
# demande de relancer `pnpm dev`.
OWLOG_BASE_PATH=/api doppler run -- pnpm --filter @owlog/api dev &
API_PID=$!

# Vite n'expose au bundle que les variables prefixees `VITE_`. Le jeton
# partage existe donc sous deux noms pour un seul et meme secret, et c'est
# ici qu'on les raccorde plutot que de stocker la valeur deux fois dans
# Doppler : deux entrees a maintenir en phase finiraient par diverger, et
# une divergence se manifeste par un 401 sur chaque recherche.
doppler run -- sh -c 'VITE_SHARED_TOKEN="$OWLOG_SHARED_TOKEN" exec pnpm --filter @owlog/web dev'
