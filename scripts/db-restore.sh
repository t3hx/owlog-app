#!/usr/bin/env bash
#
# Restauration d'une sauvegarde chiffrée d'Owlog.
#
#   OWLOG_BACKUP_AGE_IDENTITY=~/.age/owlog.txt \
#     ./scripts/db-restore.sh owlog-20260730T020000Z.sql.gz.age postgres://…
#
# Arguments :
#   1. le fichier .sql.gz.age produit par db-backup.sh
#   2. l'URL de la base CIBLE — une base fraîchement créée, vide : le dump
#      contient le schéma, restaurer par-dessus des tables existantes
#      échouerait à la première collision.
#
# Environnement :
#   OWLOG_BACKUP_AGE_IDENTITY   fichier d'identité age (clé privée) (requis)
#
# `ON_ERROR_STOP=1` : psql s'arrête à la première erreur au lieu de dérouler
# le dump en semant des erreurs — une restauration partielle qui se termine
# par « ok » est le pire des résultats.
#
# Après restauration, `auth_tokens` est vide : c'est voulu (exclue du dump).
# Les utilisateurs se reconnectent par lien magique — rien à restaurer.

set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 est requis et introuvable." >&2
    exit 1
  }
}

require psql
require age
require gzip

if [[ $# -ne 2 ]]; then
  echo "usage : db-restore.sh <fichier.sql.gz.age> <url-base-cible>" >&2
  exit 1
fi

readonly BACKUP_FILE="$1"
readonly TARGET_URL="$2"
: "${OWLOG_BACKUP_AGE_IDENTITY:?OWLOG_BACKUP_AGE_IDENTITY est requis}"

[[ -f "${BACKUP_FILE}" ]] || {
  echo "fichier introuvable : ${BACKUP_FILE}" >&2
  exit 1
}

age -d -i "${OWLOG_BACKUP_AGE_IDENTITY}" "${BACKUP_FILE}" \
  | gunzip \
  | psql "${TARGET_URL}" --set ON_ERROR_STOP=1 --quiet

echo "restauration terminée depuis ${BACKUP_FILE}"
echo "vérifie : SELECT count(*) FROM events; doit correspondre à la source."
