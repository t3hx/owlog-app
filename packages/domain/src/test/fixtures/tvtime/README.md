# Fixture TVTime — échantillon anonymisé

Extrait **anonymisé** d'un export GDPR TVTime réel, produit le 2026-07-31
(tâche T3H-53). Sert de jeu de test au parseur d'import (T3H-56, T3H-67).
L'export complet vit hors du dépôt
(`~/.gstack/projects/t3hx-owlog-app/fixtures/tvtime-gdpr-data/`) et ne doit
jamais y revenir : il contient des tokens, des hashs de mots de passe et des
données de tiers (`docs/tvtime-gdpr-data/` reste gitignoré par défense).

## Anonymisation

- `user_id` réel remplacé par `10000001` (constant dans les quatre fichiers) ;
- tous les uuids remappés par hachage déterministe — la **cohérence
  inter-fichiers est préservée**, la dédup v1/v2 par uuid reste testable ;
- noms de séries/films, ids TVDB (`s_id`, `tv_show_id`), numéros S/E, dates
  et runtimes conservés : données de catalogue public, nécessaires aux tests
  de résolution TMDB et de compaction.

## Ce que chaque fichier fait tester

| Fichier | Lignes | Particularités à couvrir |
|---|---|---|
| `tracking-prod-records-v2.csv` | 1 `tracking-stats` + 4 `user-series-*` + 12 `watch-episode-*` | ligne stats à ignorer ; blobs **map-Go** (`map[ep_id:1.06e+07 …]`) ; **timestamps en notation scientifique** ; anime (Shield Hero) pour le mapping S/E TVDB↔TMDB ; dates **sans fuseau** |
| `tracking-prod-records.csv` (v1) | 5 films + 5 épisodes + 2 `count-*` + 2 `follow` | films (`entity_type=movie`, sans id → résolution titre+date) ; épisodes **redondants avec v2** (dédup par uuid) ; lignes de comptage à ignorer |
| `user_tv_show_data.csv` | 12 | `is_favorited` → ♥ ; `nb_episodes_seen` |
| `followed_tv_show.csv` | 10 | statuts suivi/archivé → « à voir » |
