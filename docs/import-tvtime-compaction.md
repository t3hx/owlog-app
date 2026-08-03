# Import TVTime — spec de compaction (spike T3H-56)

Spécification du mapping export GDPR TVTime → événements Owlog, prête à
implémenter par T3H-67. Tous les chiffres de ce document sortent d'un script
exécuté sur le dump réel (11 913 lignes v2, 1 352 lignes v1) et de 27 requêtes
TMDB de vérification, le 2026-07-31. La fixture anonymisée commitée vit dans
`packages/domain/src/test/fixtures/tvtime/` ; le dump complet reste hors du
dépôt et n'y entre jamais.

## 0. Récap exécutable

### Décisions

| # | Décision | Valeur retenue | Justification courte |
|---|---|---|---|
| D1 | Politique de compaction | **Option (a)** : un cycle par (série × `rewatch_count`), événement final seul — jamais de `PROG` historiques | `PROG` est exclu du journal et du LOG (`HIDDEN_FROM_HISTORY`), seul le **dernier** `PROG` du cycle courant est lu (`projections.progress`) : les jalons n'ont aucune surface d'affichage. 838 événements contre 12 318 |
| D2 | Grain du cycle | 1 cycle par (série × `rewatch_count` TVTime), rang = `rewatch_count` croissant | Le visionnage est l'unité, pas l'épisode. Le dump n'a **aucun** `rewatch_count > 0` → 1 cycle par série ici |
| D3 | Série finie | `START` (1er épisode) + `SEEN` (dernier épisode) | « Fini » = épisodes réguliers distincts (`ep_id`, `s_no ≠ 0`) ≥ `number_of_episodes` TMDB, pourcentage clampé à 100 |
| D4 | Série suivie non finie | Cycle **ouvert** : `START` + un seul `PROG` (percent TMDB, label `SxxEyy` en numérotation TVTime) | C'est l'état réel : « en cours ». Le percent alimente barre et stats ; le label est du texte, pas une clé |
| D5 | Série archivée non finie | `START` + `DROP` (`occurred_precision: 'day'`) | L'archivage TVTime est l'abandon. Pas de `PROG` avant le `DROP` : le percent d'un cycle abandonné n'alimente rien, et une reprise = `REWATCH` neuf |
| D6 | Série désuivie non finie | `START` + `DROP`, comme D5 | Désuivre sans finir est un abandon |
| D7 | `is_for_later` ou suivie, zéro épisode vu | `WATCH` (à voir), daté de `followed_at` | 24 séries + 20 films `towatch`. **Jamais** de `WATCH` sur une série qui a des visionnages : un `WATCH` postérieur au cycle rebasculerait le statut à « à voir » (`loopsBackToWatchlist`) |
| D8 | `is_favorited = 1` | `FAV` hors cycle | 0 occurrence dans ce dump ; la règle reste dans le parseur |
| D9 | Dédup v1/v2 | **Par uuid** de l'enregistrement, jamais par (s_id, s_no, ep_no) | 887/887 uuids v1 inclus dans v2 ; le tuple n'en retrouve que 871 (27 épisodes renumérotés côté serveur) |
| D10 | Dates sans fuseau | Parse en **UTC figé**, `occurred_at` ISO en `Z`, heure conservée telle quelle | Déterminisme inter-machines : les bits de temps des ids en dépendent. `occurred_precision: 'exact'` partout sauf `DROP` synthétique → `'day'` |
| D11 | Ids | UUIDv7 déterministes : 48 bits temps (`occurred_at`), 12 bits séquence intra-ms, 62 bits SHA-256 | Import **idempotent** : rejouer l'import produit les mêmes ids, `restore()` dédoublonne. Tri temporel préservé (`eventsSince`, départage de rang) |
| D12 | `device_id` | Constante `import:tvtime` | Deux appareils qui importent le même dump doivent produire des événements identiques champ à champ |
| D13 | Résolution séries | `GET /find/{s_id}?external_source=tvdb_id` | 10/10 résolutions exactes et uniques sur l'échantillon testé. Échec (1 série sans nom du dump) → rapport « non résolu », rien n'est émis |
| D14 | Résolution films | Recherche par titre **sans** filtre d'année, puis titre exact + année à ±1 + popularité | `primary_release_year` strict rate Titanic (date FR 1998, TMDB 1997). Ambigus → rapport, choix manuel |
| D15 | Mapping épisode par épisode | **Abandonné** — la compaction n'en a pas besoin | Le numérateur du percent est un compte d'`ep_id` distincts, pas un mapping (s, e). Money Heist et Zestiria prouvent que le mapping (s, e) est impossible sur les découpages divergents, et que le clamp du total donne quand même le bon verdict |
| D16 | Chemin d'écriture | `restore(events, [], { enqueuePush: true, refreshState: false })` par lots, puis un `rebuildAllState()` final | C'est le chemin déjà éprouvé du premier pull (`deferRefresh: firstSync` dans `adapters/sync/engine.ts`) |

### Chiffres clés du dump

| Mesure | Valeur |
|---|---|
| Lignes `watch-episode` v2 | **11 648** (222 séries distinctes, 2017-03-02 → 2026-05-16) |
| Lignes `user-series` v2 | 263 (dont 42 sans aucun épisode vu) |
| Épisodes v1 | 887 — **100 % redondants avec v2** (dédup par uuid) |
| Films v1 (`watch`) | 175 (aucun vu deux fois) ; + 20 `towatch` |
| `rewatch_count > 0` | **0** ligne (épisodes comme séries) |
| `is_favorited = 1` | **0** ligne |
| Cycles produits | **397** (222 séries + 175 films) |
| **Événements produits (option a)** | **838** — 397 `START`, 182 `SEEN`, 168 `PROG`, 47 `DROP`, 44 `WATCH` |
| Option (b), 1 `PROG`/épisode | 12 318 événements |
| Option (b′), 1 `PROG`/saison | 1 354 événements (684 jalons) |
| Médias distincts | 441 |
| Pull `/sync` (pages de 500) | **2 pages** en (a), 25 en (b) |
| Replay complet des réducteurs (441 médias) | **2,8 ms** en (a), 7,8 ms en (b) (Node, passe chaude) |

Nota : la répartition `SEEN`/`PROG`/`DROP` ci-dessus classe par proxy les 212
séries dont le total TMDB n'a pas été vérifié pendant le spike (suivie →
`PROG`, archivée ou désuivie → `DROP`). Le **total de 838 est exact et
invariant** : chaque série avec visionnages produit exactement `START` + un
événement final, quelle que soit sa classification. L'importeur réel classera
avec les totaux qu'il récupère de toute façon pour `media_cache`.

---

## 1. Politique de compaction épisodes → cycles

### Le problème

Le modèle Owlog enregistre des **visionnages** (`MediaRef = tmdb:tv/N`), pas
des épisodes. Passer naïvement les 11 648 lignes `watch-episode` dans
`backdate` (`packages/domain/src/commands`) créerait un cycle par épisode : The Rising of
the Shield Hero afficherait `✓ vu ×51` pour une série vue une fois.

### Les options, mesurées sur le dump réel

| Option | Contenu d'un cycle | Événements totaux | Verdict |
|---|---|---|---|
| (a) événement final seul | `START` + `SEEN`\|`DROP`\|`PROG` final | **838** | **Retenue** |
| (b) 1 `PROG` par épisode | `START` + n×`PROG` + fin | 12 318 (dont 11 648 `PROG`) | Rejetée : recrée le volume qu'on compacte |
| (b′) 1 `PROG` par saison | `START` + jalons + fin | 1 354 (dont 684 jalons) | Rejetée : coût non nul, bénéfice **nul** |

Le point décisif contre (b) et (b′) n'est pas seulement le volume, c'est que
**les `PROG` historiques n'ont aucune surface d'affichage** dans le produit :

- `packages/domain/src/rules/history.ts` : `HIDDEN_FROM_HISTORY = new Set(['PROG'])` — le
  journal d'une fiche **et** le LOG global excluent les `PROG`. La « timeline
  du journal » que l'option (b) promet n'existe pas : ces événements seraient
  invisibles là où l'histoire se raconte.
- `packages/domain/src/reducers/projections.ts` (`progress`) ne lit que le **dernier**
  `PROG` du cycle **courant**. Les jalons intermédiaires ne sont jamais relus.
- `packages/domain/src/reducers/stats.ts` ne consomme jamais les dates des `PROG` : les
  minutes viennent des `SEEN` (cycles aboutis) et de `row.percent` (cycle en
  cours, période « tout » seulement).

Un seul `PROG` par cycle ouvert donne donc exactement le même rendu que 11 648,
pour 168 événements.

### Comparaison sur quatre séries réelles du dump

| Série | Situation TVTime | Épisodes vus (rég.) / total TMDB | Option (a) | Option (b) | Option (b′) |
|---|---|---|---|---|---|
| Fringe | finie, suivie | 100 / 100 | `START`@2017-03-02 + `SEEN`@2017-12-05 → `✓ vu ×1` (2 evts) | 102 evts pour le même rendu | 7 evts, même rendu |
| The Rising of the Shield Hero | en cours, suivie | 51 / 62 | `START`@2022-09-06 + `PROG{82 %, S04E01}`@2026-05-16, cycle **ouvert** → « en cours » (2 evts) | 53 evts, même barre affichée | 6 evts, même barre |
| The Strain | archivée, non finie | 36 / 46 | `START`@2017-03-12 + `DROP`@2021-01-17 → « abandonné » (2 evts) | 38 evts | 6 evts |
| Aucune série `rewatch_count > 0` dans le dump | — | — | Règle écrite (D2) mais **non exercée** : à couvrir en test synthétique (cf. fixture) | — | — |

Cas revisionnage (synthétique, règle D2) : une série avec des lignes
`rewatch_count = 1` produit deux cycles — `START`+`SEEN` (rang 0) puis
`REWATCH`+`SEEN` (rang 1) — chacun daté de ses propres épisodes, jamais deux
`START` sur le même média (règle de `setStatus`).

### Table de correspondance complète TVTime → événements

| Source TVTime | Condition | Événements émis | `occurred_at` |
|---|---|---|---|
| `watch-episode` groupés par (s_id, `rewatch_count`) | toujours | `START` (rang 0) ou `REWATCH` (rang ≥ 1), mintant le `cycle_key` du groupe | min(`created_at`) du groupe |
| — | épisodes réguliers distincts ≥ total TMDB (clamp 100) | + `SEEN` | max(`created_at`) du groupe |
| — | non fini **et** `is_followed` sans `is_archived` | + `PROG { percent, label: "SxxEyy", label_created_at }` — cycle laissé **ouvert** | max(`created_at`) |
| — | non fini **et** (`is_archived` **ou** désuivie **ou** sans ligne `user-series`) | + `DROP` (`occurred_precision: 'day'`) | max(`created_at`) |
| `user-series` sans épisode vu | (`is_followed` ou `is_for_later`) et non archivée | `WATCH` | `followed_at` (µs epoch), sinon `created_at` |
| `user-series` sans épisode vu | archivée, ou ni suivie ni `for_later` | rien | — |
| v1 `watch` + `entity_type=movie` | toujours | `START` + `SEEN` (rétro-datage, même date — le geste de `backdate`) | `created_at` (= epoch de `watch_date_range_key`, vérifié identique sur 175/175) |
| v1 `towatch` | toujours | `WATCH` | `created_at` |
| v1 `watch` + `entity_type=episode` | — | **rien** : redondance totale avec v2 (§3) | — |
| v1 `follow` (195, tous films) | — | rien : c'est l'union exacte films vus + `towatch`, déjà couverts | — |
| v1 `count-*`, `last-episode-watched`, `time-count`, ligne `tracking-stats` v2 | — | rien : lignes de comptage dénormalisées | — |
| `user_tv_show_data.is_favorited = 1` | toujours | `FAV` hors cycle (0 dans ce dump) | `created_at` de la ligne |

Le label `SxxEyy` du `PROG` vient du **dernier épisode régulier** (`s_no ≠ 0`,
`ep_no ≠ 0`, départage par (`created_at`, s, e)) : vérifié cohérent avec le
champ `most_recent_ep_watched` de TVTime sur 207/220 séries, les 13 écarts
étant précisément des specials S0 ou des `ep_no = 0` en fin de liste.

Comptes du dump : 222 cycles séries (175 suivies non archivées, 45 archivées,
1 désuivie, 1 sans ligne `user-series`), 175 cycles films, 24 `WATCH` séries
(sur 42 séries sans visionnage ; 18 ignorées car archivées ou ni suivies ni
`for_later`), 20 `WATCH` films.

## 2. Mapping S/E TVDB ↔ TMDB

Les `s_id` sont des ids **TVDB**. `GET /3/find/{s_id}?external_source=tvdb_id`
résout la **série** : 10/10 exacts et uniques sur l'échantillon testé
(Shield Hero, Fate/Stay Night, House, One-Punch Man, Money Heist, Fringe,
Agents of S.H.I.E.L.D., Tales of Zestiria the X, Demon Slayer, The Strain).
Une seule série du dump échoue : 11 épisodes **sans nom de série** dans
l'export (émission supprimée de TVDB) — `/find` rend vide → « non résolu »,
rapport, aucun événement.

La numérotation (saison, épisode), elle, n'est **pas** fiable :

| Série | Saisons TVTime (nb éps) | Saisons TMDB (rég.) | Écart |
|---|---|---|---|
| Fringe | {1:20, 2:23, 3:22, 4:22, 5:13} | identique | aucun |
| Shield Hero | {1:25, 2:13, 3:12, 4:1} | {1:25, 2:13, 3:12, 4:12} | aucun |
| Demon Slayer | {1:26, 2:7, 3:11, 4:11, 5:8} | identique (découpage par arcs) | aucun |
| House | rég. identiques + S0 : 2 vus | S0 TMDB = 46 | specials mappables ici |
| **Money Heist** | {1:9, 2:13, 3:8, 4:8, 5:10} = 48 | {1:15, 2:16, 3:10} = 41 | **découpages incompatibles** (parts Netflix vs diffusion) — aucune saison ne correspond |
| **Tales of Zestiria the X** | {1:25, 2:13} = 38, dont 13 lignes `(2, 0)` | {1:12, 2:13} = 25 | numérotation TVDB continue ; 13 épisodes ont **perdu leur `ep_no`** (`= 0`) lors d'une renumérotation |
| **One-Punch Man** | S0 : 16 épisodes vus | S0 TMDB = 15 | épisodes spéciaux **sans équivalent TMDB** |
| Agents of S.H.I.E.L.D. | S0 : 6 vus (Slingshot) | S0 TMDB = 11 | mappable, mais hors décompte |

Verdict : **le mapping par (saison, épisode) est fiable sur les séries à
diffusion classique et cassé sur les animes à arcs, les découpages plateforme
et les specials.** Le dump contient 59 lignes S0 et 27 lignes `ep_no = 0`
irrécupérables épisode par épisode.

**C'est ce qui amortit le choix D15 : la compaction retenue n'a jamais besoin
de résoudre un épisode.** Le percent se calcule ainsi :

```
percent = min(100, round(100 × |ep_id distincts, s_no ≠ 0| / number_of_episodes TMDB))
```

- Le numérateur est un **compte**, pas un mapping : les 13 lignes `(2, 0)` de
  Zestiria comptent (ep_id distincts), les specials S0 sont exclus car
  `number_of_episodes` TMDB les exclut.
- Le **clamp à 100** absorbe les totaux divergents : Money Heist 48/41 → 100 →
  `SEEN` (juste : tout a été vu) ; Zestiria 38/25 → 100 → `SEEN` (juste).
- Règle de repli quand une saison TVTime n'existe pas côté TMDB : **aucun
  épisode n'est ignoré ni « non résolu »** — il pèse dans le compte, et seules
  ses coordonnées d'affichage (label) peuvent être approximatives. Le label
  garde la numérotation TVTime telle quelle : c'est du texte porté par
  `payload.label`, jamais une clé de résolution — au pire il affiche `S02E08`
  là où TMDB dirait autrement, avec `label_created_at` qui le date.

Films : recherche par titre sans année (D14). Vérifié sur les cas vicieux du
dump : `primary_release_year=1998` **exclut** le vrai Titanic (sortie FR 1998,
TMDB 1997) → le filtre strict est interdit ; « Home » (2009) se départage par
année ; `기생충` (titre original) résout Parasite en 1 résultat ; « Scream »
(2022) se départage du film de 1996 par l'année. 50 films du dump ont une date
`0001-01-01` → titre + popularité seuls, ambigus mis en rapport.

## 3. Dédup v1/v2

Démontré sur les données réelles :

| Mesure | Valeur |
|---|---|
| Épisodes v1 (`type=watch`, `entity_type=episode`) | 887 |
| Uuids v1 ∩ uuids v2 (2e uuid de la clé `watch-episode-{série}-{visionnage}`) | **887 / 887** — inclusion totale |
| Restes v1 par uuid | **0** |
| Intersection par tuple (s_id, s_no, ep_no) | 871 seulement |
| Uuids communs mais tuples différents | 27 (renumérotation serveur entre v1 et v2) |
| Faux « restes » v1 qu'une dédup par tuple inventerait | 16 |

**Règle retenue (D9) : dédup par uuid.** v2 est la source des épisodes ; v1 ne
fournit que ce que v2 n'a pas — les films (`watch` movie, `towatch`). La dédup
par tuple est interdite : elle créerait 16 doublons fantômes et raterait les
27 renumérotés.

Contrôle de cohérence : la ligne `tracking-stats` v2 annonce 11 658 épisodes et
172 films pour 11 648 et 175 lignes réelles — les compteurs dénormalisés de
TVTime dérivent, on ne s'en sert jamais.

## 4. Dates sans fuseau

Les timestamps TVTime (`2022-09-06 00:16:12`) ne portent aucun offset.
**Décision (D10) : parse en UTC figé**, `occurred_at = created_at =`
`2022-09-06T00:16:12.000Z`.

Pourquoi UTC figé et pas le fuseau local : les **bits de temps des ids
déterministes (§5) dérivent d'`occurred_at`**. Parser dans le fuseau de la
machine ferait produire des ids différents à deux appareils qui importent le
même fichier, ce qui casserait l'idempotence par `restore()`. L'erreur
absolue éventuelle (le vrai fuseau de saisie est inconnu) est de quelques
heures sur des données qui s'étalent sur neuf ans ; le déterminisme vaut plus.

`occurred_precision` existe dans le schéma (`packages/domain/src/types.ts`,
`DatePrecision`) — aucun changement de schéma nécessaire :

- `'exact'` partout : l'instant TVTime est le moment réel du geste de marquage.
- `'day'` sur les `DROP` synthétiques : la date d'abandon n'est pas un fait
  enregistré par TVTime, c'est notre approximation (dernier épisode vu).

Limite connue, assumée : le marquage en masse. 175 films sur **12 jours
distincts** (rafales de 63, 44 et 35 films/jour), et des séries entières
marquées en secondes (House : 178 épisodes en 10 s, `bulk_type:
fill-previous` ; rafale max du dump : 284 lignes dans la même seconde). Ces
dates sont des dates de **saisie**, pas de visionnage. On les garde en
`'exact'` : c'est la donnée telle que TVTime l'a enregistrée, une heuristique
de dégradation (rafale → `'unknown'`) éditorialiserait la source et viderait
`occurred_at` (le schéma impose `null` si `unknown`), au prix de la
chronologie du journal. Alternative documentée pour T3H-67 si les stats
fenêtrées s'avéraient trop polluées.

## 5. Schéma d'ids déterministes v7-temporels

Contrainte : `eventsSince`/`eventsRecent` (`apps/web/src/adapters/dexie/eventStore.ts`)
paginent par `id` croissant, et le départage de rang des cycles finit sur
l'`id`. Les ids d'import doivent donc être des UUID **valides, triés par le
temps de survenue, et identiques d'une machine à l'autre**.

Layout (conforme RFC 9562, UUIDv7) :

```
 48 bits   unix_ts_ms  = occurred_at de l'événement (UTC figé, §4)
  4 bits   version     = 0b0111 (7)
 12 bits   seq         = ordinal de l'événement DANS la même milliseconde,
                         dans l'ordre d'émission déterministe (tri par clé
                         source) — 4096 max ; rafale max observée après
                         compaction : 287/ms en option (b), 2/ms en (a)
  2 bits   variant     = 0b10
 62 bits   hash        = 62 bits de poids fort de
                         SHA-256("owlog:tvtime-import:v1|" + tag)
```

Le `tag` identifie la source de façon stable :

- événement de série : `tv|{s_id}|{ordinal}|{TYPE}` (ids TVDB, publics) ;
- événement de film : `mv|{uuid TVTime de l'enregistrement}|{ordinal}|{TYPE}` ;
- `cycle_key` : même schéma avec le pseudo-type `CYCLE` et le rang du cycle
  (= `rewatch_count`), bits de temps du `START`.

Exemple calculé (Fringe, TVDB 82066, premier épisode marqué
`2017-03-02 13:06:40` UTC → `unix_ts_ms = 1488460000000`) :

```
tag = "owlog:tvtime-import:v1|tv|82066|0|START"
id  = 015a8f21-2b00-7000-bb19-e94899feed98
      └─ 015a8f212b00 = 1488460000000 ms ─┘ └ 7 = version, 000 = seq ┘ └ b…= variant+hash ┘
```

Propriétés vérifiées par le script sur les 838 événements : aucun doublon,
tri lexicographique des ids = tri chronologique d'émission. Un re-import
complet reproduit les 838 mêmes ids : `restore()` répond
`{ added: 0, skipped: 838 }` — l'import est idempotent par construction, sur
l'appareil comme à travers la sync (le serveur dédoublonne par id).

`seq` (12 bits) remplace l'aléa `rand_a` : il rend l'ordre intra-milliseconde
déterministe — le `SEEN` d'un film rétro-daté trie après son `START` de même
`occurred_at`, ce que l'aléa ne garantirait pas.

## 6. Parseur des pièges

Trois formats hostiles dans `tracking-prod-records-v2.csv`, tous démontrés sur
le dump réel :

**Blobs map-Go** (`most_recent_ep_watched`) :

```python
MAP_RE = re.compile(r"(\w+):((?:[^\s\]]+))")

def parse_go_map(blob):
    """`map[k:v k:v ...]` -> dict. Séparateur : espaces, pas de quoting."""
    if not blob.startswith("map["):
        return {}
    return dict(MAP_RE.findall(blob[4:-1]))

# map[ep_id:1.0664238e+07 ep_no:1 s_no:4 uuid:… watch_date:1.778954928305394e+15]
# -> {'ep_id': '1.0664238e+07', 'ep_no': '1', 's_no': '4', …}
```

**Timestamps en notation scientifique** — ce sont des **microsecondes** epoch
(`e+15` µs ≈ 2022 ; interprétés en ms, ce serait l'an 52 000) :

```python
def parse_sci_epoch_us(value):
    if not value:
        return None
    return int(float(value)) // 1000   # µs -> ms epoch

# '1.778954928305394e+15' -> 2026-05-16T18:08:48.305Z
# followed_at '1661895894436036' (entier, mêmes µs) -> 2022-08-30T21:44:54.436Z
```

**Dates naïves** : `datetime.strptime(...).replace(tzinfo=UTC)` (§4).

**Champs réellement nécessaires** — et c'est le résultat important : **aucun
champ des blobs map-Go n'est nécessaire.** `most_recent_ep_watched` est
reconstructible depuis les lignes `watch-episode` (vérifié : 207/220
cohérents, écarts = specials/`ep_no 0`, notre départage est même plus juste).
La liste exhaustive des champs consommés :

- `watch-episode` : `key` (uuids), `created_at`, `s_id`, `s_no`, `ep_no`,
  `ep_id`, `series_name` (rapport), `rewatch_count` ;
- `user-series` : `s_id`, `uuid`, `is_followed`, `is_archived`,
  `is_for_later`, `followed_at` (µs sci.), `created_at` ;
- v1 : `uuid`, `type`, `entity_type`, `created_at`, `movie_name`,
  `release_date` ;
- `user_tv_show_data` : `tv_show_id`, `is_favorited`.

Tout le reste (gsi, range_keys, runtime, compteurs, stats-prod-cache…) est
ignoré.

## 7. Mesures de perf

### Replay pur (mesuré, Node via vitest, fichier temporaire supprimé depuis)

Protocole : la liste d'événements réelle produite par la compaction est
rejouée par les vrais réducteurs — `mediaState(events, ref)` par média, ce que
fait `rebuildAllState()` — deux passes, chiffres de la passe chaude :

| Scénario | Événements | Médias | Replay complet | Média le plus lourd | `stats(all)` |
|---|---|---|---|---|---|
| Option (a) retenue | 838 | 441 | **2,8 ms** | 0,05 ms | 0,48 ms |
| Option (b) rejetée | 12 318 | 441 | 7,8 ms | 1,14 ms | 1,40 ms |

Même à 12 318 événements, le calcul pur est négligeable : **le coût réel est
l'I/O IndexedDB** (une requête `eventsForMedia` par média), pas les réducteurs.

### Estimations (calcul, chemins de code cités)

- **Pull.** `SYNC_BATCH_LIMIT = 500` (`packages/contracts/src/sync.ts:18`).
  838 événements = **2 pages** ; un `restore()` par page
  (`apps/web/src/adapters/sync/engine.ts`, `pullAll`). Le recalcul par média
  serait O(n²) par lot — c'est déjà traité : `syncPass` passe
  `deferRefresh: firstSync` et fait **un** `rebuildAllState()` final. L'import
  local doit emprunter exactement ce chemin (D16) :
  `restore(events, [], { refreshState: false })` par lots, puis
  `rebuildAllState()` — soit 441 requêtes + 441 `mediaState` (~3 ms de calcul,
  le reste en I/O), une fois.
- **Push après import.** Les 838 événements entrent dans `pending_push` via
  `restore(enqueuePush: true)` → 2 lots de 500 vers `/sync`.
- **Écran Stats.** `apps/web/src/ui/hooks/useStats.ts` (boucle `for` de
  l'effet) : une requête `eventsForMedia` **séquentielle** par média de la
  bibliothèque. Après import : 441 requêtes en série, soit ~50-450 ms selon la
  latence IndexedDB (0,1-1 ms/req), une fois par changement de bibliothèque
  (mémoïsé par la clé `refs`). Acceptable au lancement, mais à surveiller.
- **Seuils recommandés pour T3H-67** :
  - recalcul différé (`refreshState: false` + `rebuildAllState` final) dès que
    l'import dépasse **une page (500 événements)** ou touche plus de
    **50 médias** — ce dump déclenche les deux ;
  - import découpé en transactions de 500 (la taille des lots `/sync`), jamais
    une transaction unique de 838 ;
  - au-delà de ~200 médias en bibliothèque, paralléliser la boucle de
    `useStats` (`Promise.all`) — hors périmètre import, à ouvrir séparément.

---

## Points restés ouverts pour T3H-67

1. **Rapport de fin d'import** : 1 série non résoluble (11 épisodes, sans nom,
   TVDB supprimé) et les films ambigus (50 sans date de sortie) doivent être
   présentés à l'utilisateur — forme UI à définir (liste avec recherche
   manuelle ?).
2. **`rewatch_count > 0` non exercé** par ce dump : la règle D2 doit être
   couverte par un test synthétique (la fixture anonymisée est prête à en
   accueillir un cas).
3. **Percent des séries non finies** : nécessite `number_of_episodes` via
   `/tv/{id}` — l'importeur le récupère de toute façon pour `media_cache`
   (titre, affiche, durée) ; ordonner résolution → cache → émission.
4. **Budget API** : 222 `/find` + ~222 `/tv` + ~175 `/search/movie` ≈ 620
   requêtes pour ce dump — throttle poli (~4 req/s) et reprise sur erreur à
   prévoir ; la clé reste dans `owlog-api`, donc ces appels passent par de
   nouvelles routes proxy ou un endpoint d'import dédié — à trancher.
5. **Dégradation de précision des rafales** (142 films marqués sur 3 jours) :
   décidé `'exact'` (D10), alternative `'unknown'` documentée §4 si le retour
   d'usage montre des stats fenêtrées trompeuses.
