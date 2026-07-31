#!/usr/bin/env bash
#
# Sauvegarde chiffrée du Postgres d'Owlog.
#
# Remplacer le `.log` manuel par un Postgres non sauvegardé serait un recul
# de durabilité déguisé : ce script est la contrepartie obligatoire du
# socle serveur. Il produit un dump chiffré, le range localement, et le
# pousse hors du VPS si un remote rclone est configuré.
#
#   DATABASE_URL=postgres://… OWLOG_BACKUP_AGE_RECIPIENT=age1… \
#     ./scripts/db-backup.sh
#
# Environnement :
#   DATABASE_URL                  la base à sauvegarder            (requis)
#   OWLOG_BACKUP_AGE_RECIPIENT    clé publique age du destinataire (requis)
#   OWLOG_BACKUP_DIR              dossier local des dumps  (défaut /var/backups/owlog)
#   OWLOG_BACKUP_RCLONE_REMOTE    remote rclone, ex. r2:owlog-backups (optionnel)
#   OWLOG_BACKUP_KEEP             dumps locaux conservés   (défaut 14)
#
# Trois choix, et pourquoi :
#
# - `--exclude-table-data=auth_tokens` : les jetons de connexion, même
#   hachés, n'ont rien à faire dans un fichier qui voyage. La table reste
#   dans le schéma (le dump se restaure tel quel), ses lignes non — elles
#   expirent en 15 minutes de toute façon.
# - chiffrement age côté flux : le dump n'existe JAMAIS en clair sur le
#   disque, même le temps d'un renommage. La clé privée ne vit pas sur le
#   VPS — un attaquant qui lit la machine lit des sauvegardes illisibles.
# - object storage et pas un dépôt git : l'historique git n'oublie jamais,
#   et l'ordre des lignes de pg_dump n'est pas stable — le « diff trivial »
#   serait un mensonge de toute façon.

set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 est requis et introuvable." >&2
    exit 1
  }
}

require pg_dump
require age
require gzip

: "${DATABASE_URL:?DATABASE_URL est requis}"
: "${OWLOG_BACKUP_AGE_RECIPIENT:?OWLOG_BACKUP_AGE_RECIPIENT est requis}"

readonly BACKUP_DIR="${OWLOG_BACKUP_DIR:-/var/backups/owlog}"
readonly KEEP="${OWLOG_BACKUP_KEEP:-14}"
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly TARGET="${BACKUP_DIR}/owlog-${STAMP}.sql.gz.age"

mkdir -p "${BACKUP_DIR}"

# `--no-owner --no-privileges` : la restauration se fait sous l'utilisateur
# du moment, pas sous celui d'origine — un dump doit se restaurer partout.
# Le `set -o pipefail` du haut est la ligne qui compte : sans lui, un
# pg_dump qui meurt en cours laisserait un fichier chiffré tronqué à l'air
# parfaitement sain, et l'erreur ne se verrait qu'au jour de la
# restauration — le pire jour pour la voir.
pg_dump "${DATABASE_URL}" \
  --exclude-table-data=auth_tokens \
  --no-owner \
  --no-privileges \
  | gzip \
  | age -r "${OWLOG_BACKUP_AGE_RECIPIENT}" \
  > "${TARGET}"

echo "sauvegarde : ${TARGET} ($(du -h "${TARGET}" | cut -f1))"

# Rotation locale : les dumps les plus récents restent, le reste part.
# L'historique long vit dans l'object storage, pas sur le disque du VPS.
ls -1t "${BACKUP_DIR}"/owlog-*.sql.gz.age 2>/dev/null \
  | tail -n +"$((KEEP + 1))" \
  | while read -r old; do
      rm -f "${old}"
      echo "rotation : ${old} supprimé"
    done

if [[ -n "${OWLOG_BACKUP_RCLONE_REMOTE:-}" ]]; then
  require rclone
  rclone copy "${TARGET}" "${OWLOG_BACKUP_RCLONE_REMOTE}"
  echo "poussé vers ${OWLOG_BACKUP_RCLONE_REMOTE}"
else
  echo "OWLOG_BACKUP_RCLONE_REMOTE absent : dump local seulement." >&2
fi
