#!/usr/bin/env bash
#
# Developpement local : owlog-api et owlog-web ensemble, sous la topologie
# de la production.
#
#   pnpm dev            # ce script
#
# Pourquoi un script plutot qu'un `pnpm -r dev` : la config Doppler du projet
# est `prd`, et trois de ses valeurs sont justes en production et fausses en
# local. Sans les neutraliser, l'app demarre et dit « hors-ligne » sans
# expliquer pourquoi.
#
#   DATABASE_URL          pointe l'hote Postgres du VPS, injoignable d'ici.
#                         Vide, l'API repond 503 sur /auth et /sync et sert
#                         tout le reste. C'est le mode local-first du temps 1,
#                         et il suffit a tout tester sauf la synchronisation.
#   OWLOG_SHARED_TOKEN    le vrai jeton de production. Le bundle de dev, lui,
#                         se rabat sur `local-token` : les deux doivent
#                         coincider, sinon chaque recherche repond 401. On
#                         aligne le service sur le client, pas l'inverse — le
#                         jeton de production n'a rien a faire ici.
#   OWLOG_BASE_PATH       reste `/api`. C'est la valeur de production, et le
#                         proxy du serveur de dev relaie `/api` tel quel.
#
# La vraie correction est une config `dev` dans Doppler. Tant qu'elle
# n'existe pas, ce script est le seul endroit qui connait l'ecart.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v doppler > /dev/null 2>&1; then
  echo "doppler est introuvable. Les secrets du projet vivent dedans." >&2
  exit 1
fi

# Sans ce nettoyage, un service laisse par une session precedente garde le
# port et le suivant meurt sur EADDRINUSE — message qui ne dit pas qu'il
# suffit de tuer l'ancien.
cleanup() {
  local status=$?
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2> /dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

doppler run -- env \
  DATABASE_URL= \
  OWLOG_SHARED_TOKEN=local-token \
  pnpm --filter @owlog/api dev &
API_PID=$!

doppler run -- pnpm --filter @owlog/web dev
