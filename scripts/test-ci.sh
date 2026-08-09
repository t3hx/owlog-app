#!/usr/bin/env bash
# Lance les tests de tous les paquets de l'espace de travail, puis transforme un
# saut silencieux des tests d'intégration DB en échec — mais seulement en CI.
#
# Ce garde-fou vivait auparavant dans `ci.yml`. Il est descendu ici pour que le
# workflow reste identique d'un projet à l'autre : le workflow dit CE QUI
# tourne, ce script dit COMMENT owlog le fait.
#
# Le harnais saute les tests DB avec un avertissement quand Docker est absent.
# En local c'est un confort ; en CI, ce serait une perte de couverture
# invisible — d'où la promotion en erreur, conditionnée à $CI pour ne pas
# gêner un poste de développement sans Docker.
set -euo pipefail

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# `pnpm -r` n'inclut pas le projet racine : aucune récursion infinie ici.
pnpm -r test 2>&1 | tee "$log"

if [ "${CI:-}" = "true" ] && grep -q "tests d'intégration DB ignorés" "$log"; then
  echo "::error::Les tests d'intégration DB ont été sautés — Postgres indisponible."
  exit 1
fi
