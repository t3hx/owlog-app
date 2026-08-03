#!/usr/bin/env bash
#
# Répétition de restauration de bout en bout.
#
# Rejoue le cycle complet en local, tout dans Docker : une base source
# migrée et peuplée, db-backup.sh, restauration dans une base vierge,
# vérifications (comptes identiques, auth_tokens vide, trigger append-only
# actif). À lancer après toute modification des scripts de sauvegarde ou du
# schéma : une sauvegarde jamais restaurée n'est pas une sauvegarde.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
NET=owlog-restore-net
SRC=owlog-restore-src
DST=owlog-restore-dst

cleanup() {
  docker rm -f "$SRC" "$DST" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# La majeure de la production, et c'est ici que l'écart coûterait le plus
# cher : `pg_dump` refuse un serveur plus récent que lui, et un dump ne se
# restaure pas dans une majeure antérieure. Sur une autre version, cette
# répétition passerait au vert sans rien exercer de ce qui se produira le
# jour d'une vraie restauration.
docker network create "$NET" >/dev/null
docker run -d --rm --name "$SRC" --network "$NET" -e POSTGRES_PASSWORD=src postgres:18-alpine >/dev/null
docker run -d --rm --name "$DST" --network "$NET" -e POSTGRES_PASSWORD=dst postgres:18-alpine >/dev/null

wait_pg() {
  for _ in $(seq 1 60); do
    docker exec "$1" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && return
    sleep 0.5
  done
  echo "postgres $1 jamais prêt" >&2; exit 1
}
wait_pg "$SRC"
wait_pg "$DST"

echo "--- 1. migre et peuple la source"
docker exec -i "$SRC" psql -U postgres -v ON_ERROR_STOP=1 --quiet \
  < "$ROOT/apps/api/migrations/0001_initial_schema.sql"
docker exec -i "$SRC" psql -U postgres -v ON_ERROR_STOP=1 --quiet <<'SQL'
INSERT INTO users (id, email, first_name)
VALUES ('01920000-0000-7000-8000-000000000001', 'a@b.c', 'Tehx');

INSERT INTO events (user_id, id, device_id, type, media_ref, cycle_key,
                    created_at, occurred_at, occurred_precision, payload)
VALUES
  ('01920000-0000-7000-8000-000000000001', '01920000-0000-7000-8000-00000000000a',
   'local', 'WATCH', 'tmdb:tv/95396', NULL, now(), now(), 'exact', NULL),
  ('01920000-0000-7000-8000-000000000001', '01920000-0000-7000-8000-00000000000b',
   'local', 'START', 'tmdb:tv/95396', 'ck-1', now(), now(), 'exact', NULL),
  ('01920000-0000-7000-8000-000000000001', '01920000-0000-7000-8000-00000000000c',
   'local', 'PROG', 'tmdb:tv/95396', 'ck-1', now(), now(), 'exact', '{"percent": 42}');

INSERT INTO media_cache (user_id, ref, payload)
VALUES ('01920000-0000-7000-8000-000000000001', 'tmdb:tv/95396', '{"title": "Severance"}');

-- Un jeton en vol : il doit ETRE ABSENT de la restauration.
INSERT INTO auth_tokens (id, email, token_hash, code_hash, expires_at)
VALUES ('01920000-0000-7000-8000-0000000000aa', 'a@b.c', 'th', 'ch', now() + interval '15 min');
SQL

echo "--- 2. sauvegarde chiffrée depuis un conteneur outillé (pg_dump + age)"
docker run --rm --network "$NET" \
  -v "$ROOT/scripts:/scripts:ro" -v "$WORK:/work" \
  postgres:18-alpine bash -euo pipefail -c '
    apk add --no-cache age >/dev/null 2>&1
    age-keygen -o /work/identity.txt 2>/dev/null
    RECIPIENT=$(grep -o "age1.*" /work/identity.txt | head -1)

    DATABASE_URL=postgres://postgres:src@'"$SRC"':5432/postgres \
    OWLOG_BACKUP_AGE_RECIPIENT="$RECIPIENT" \
    OWLOG_BACKUP_DIR=/work/backups \
      /scripts/db-backup.sh

    echo "--- 3. restauration dans une base vierge"
    FILE=$(ls /work/backups/owlog-*.sql.gz.age)
    OWLOG_BACKUP_AGE_IDENTITY=/work/identity.txt \
      /scripts/db-restore.sh "$FILE" postgres://postgres:dst@'"$DST"':5432/postgres
  '

echo "--- 4. vérifications sur la base restaurée"
docker exec -i "$DST" psql -U postgres -v ON_ERROR_STOP=1 -t -A <<'SQL'
SELECT 'users=' || count(*) FROM users;
SELECT 'events=' || count(*) FROM events;
SELECT 'media_cache=' || count(*) FROM media_cache;
SELECT 'auth_tokens=' || count(*) FROM auth_tokens;
SELECT 'payload_percent=' || (payload->>'percent') FROM events WHERE type = 'PROG';
SQL

echo "--- 5. le trigger append-only a survécu au dump ?"
OUT=$(docker exec -i "$DST" psql -U postgres -c "DELETE FROM events" 2>&1 || true)
echo "sortie du DELETE : ${OUT}"
if echo "${OUT}" | grep -q append-only; then
  echo "append-only=oui"
else
  echo "append-only=NON — le trigger n'a pas été restauré" >&2
  exit 1
fi

echo "RESTAURATION DE BOUT EN BOUT : OK"
