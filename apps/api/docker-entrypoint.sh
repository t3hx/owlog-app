#!/bin/sh
#
# Demarrage de owlog-api, sous Doppler quand un jeton de service est fourni.
#
# Deux modes, et un seul discriminant : la presence de DOPPLER_TOKEN.
#
#   avec jeton    le conteneur va chercher ses secrets chez Doppler au
#                 demarrage. C'est le mode de production : l'orchestrateur
#                 ne detient qu'un jeton de service, scope a une config et
#                 en lecture seule, et jamais les secrets eux-memes.
#
#   sans jeton    le service demarre sur l'environnement tel qu'il est
#                 fourni. C'est ce dont `scripts/local-prod.sh` a besoin
#                 pour rejouer la vraie image en local avec des valeurs de
#                 developpement, sans exiger un jeton de service pour une
#                 verification d'avant-deploiement.
#
# Ce second mode n'ouvre pas la porte a une production mal configuree. Un
# oubli de DOPPLER_TOKEN en ligne ne donne pas un service degrade et
# silencieux : sans TMDB_API_TOKEN ni OWLOG_SHARED_TOKEN, `loadConfig`
# refuse de demarrer et le conteneur meurt avec le nom de la variable
# manquante.
set -eu

SERVER="node --experimental-strip-types src/server.ts"

if [ -n "${DOPPLER_TOKEN:-}" ]; then
  # Le mode retenu est trace dans les journaux : c'est la seule facon de
  # distinguer, devant un incident, un conteneur qui lit Doppler d'un
  # conteneur qui tourne sur des variables posees a la main.
  echo "owlog-api: starting through Doppler" >&2

  # --fallback ecrit un instantane CHIFFRE des secrets a chaque lecture
  # reussie, et le relit quand l'API Doppler est injoignable. Sans lui, une
  # panne chez Doppler empeche tout redemarrage de conteneur — le service
  # deviendrait indisponible pour une cause exterieure a l'infrastructure.
  # Le fichier vit sous /home/node : ecrivable par l'utilisateur du
  # conteneur, hors de /tmp que tout processus peut lister.
  #
  # --forward-signals parce que doppler devient PID 1 et que node est son
  # enfant. Sans relais, le SIGTERM d'un `docker stop` s'arrete au parent et
  # le service est tue au bout du delai de grace au lieu de s'arreter
  # proprement. La valeur par defaut ferait deja ce choix hors TTY ; on ne
  # laisse pas un comportement d'arret dependre de la facon dont le
  # conteneur a ete lance.
  exec doppler run \
    --fallback /home/node/doppler-fallback.json \
    --forward-signals \
    -- $SERVER
fi

echo "owlog-api: starting without Doppler (environment as provided)" >&2
exec $SERVER
