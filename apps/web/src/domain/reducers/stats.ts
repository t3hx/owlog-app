import { applyVoids } from '@/domain/reducers/applyVoids'
import { filterLibrary, type MediaStateRow } from '@/domain/reducers/mediaState'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import type { DatePrecision, MediaRef, StoredEvent, Timestamp } from '@/domain/types'

/** Fenêtre du sélecteur de période : 30 jours, un an, ou tout. */
export type StatsPeriod = 'month' | 'year' | 'all'

/**
 * Ce que les stats ont besoin de savoir d'un média.
 *
 * Un sous-ensemble de `media_cache`, redéclaré ici : le domaine ne dépend
 * pas de la forme d'une copie locale d'API tierce. L'écran fait la
 * conversion, et le jour où le cache change de forme, le réducteur ne bouge
 * pas.
 */
export interface StatsMedia {
  readonly kind: 'movie' | 'tv'
  /** Minutes. `null` très souvent sur les séries — voir `episode_run_time`. */
  readonly totalRuntime: number | null
  readonly numberOfEpisodes: number | null
  readonly genres: readonly string[]
  /** Faux tant que la fiche n'a jamais été ouverte : ni genres, ni durée. */
  readonly complete: boolean
}

/** Bornes d'une fenêtre, incluses. */
export interface StatsWindow {
  readonly from: Timestamp
  readonly to: Timestamp
}

export interface StatsInput {
  readonly states: readonly MediaStateRow[]
  readonly eventsByMedia: ReadonlyMap<MediaRef, readonly StoredEvent[]>
  readonly cache: ReadonlyMap<MediaRef, StatsMedia>
  readonly period: StatsPeriod
  /**
   * Fenêtre retenue, et la précédente pour le delta. `null` sur « tout ».
   *
   * **Calculées par l'appelant, jamais ici.** Le domaine n'a pas le droit de
   * connaître `Date`, et une arithmétique de calendrier réclamerait
   * exactement ce qu'on lui interdit. Ce qui reste ici est la règle — quelle
   * précision de date a le droit d'entrer dans quelle fenêtre — et elle est
   * bien du domaine.
   *
   * La comparaison se fait sur les chaînes ISO en UTC, qui se trient
   * correctement telles quelles.
   */
  readonly window: StatsWindow | null
  readonly previousWindow: StatsWindow | null
}

export interface StatsRatings {
  /** ★4-5. */
  readonly good: number
  /** ★3. */
  readonly mid: number
  /** ★1-2. */
  readonly bad: number
  readonly rated: number
  readonly average: number | null
}

export interface StatsGenre {
  readonly name: string
  readonly percent: number
}

export interface StatsView {
  readonly totalMinutes: number
  readonly movieMinutes: number
  readonly seriesMinutes: number
  /** Même durée de fenêtre, juste avant. `null` sur « tout ». */
  readonly previousMinutes: number | null
  /** Séries écartées du total faute de durée connue. **Affiché, pas masqué.** */
  readonly seriesWithoutRuntime: number
  readonly movieCount: number
  readonly seriesCount: number
  readonly counts: {
    readonly seen: number
    readonly watching: number
    readonly favorites: number
  }
  readonly ratings: StatsRatings
  /** Part des cycles ouverts qui ont abouti. `null` sans aucun cycle. */
  readonly completion: number | null
  readonly rewatches: number
  readonly episodesSeen: number
  readonly genres: readonly StatsGenre[]
  /** Médias écartés du classement faute de fiche ouverte. */
  readonly mediaWithoutGenres: number
}

/**
 * Toutes les valeurs de l'écran de stats.
 *
 * **Les exclusions sont comptées, jamais tues.** C'est la contrainte qui
 * commande la forme de ce réducteur : une durée totale qui laisse tomber en
 * silence les séries dont TMDB ne donne pas la durée est un chiffre faux qui
 * a l'air juste — et TMDB rend `episode_run_time` vide très souvent, y
 * compris sur des séries majeures. Le réducteur rend donc le total **et** le
 * nombre de titres qu'il n'a pas pu compter.
 *
 * Deux règles de temps qui ne se devinent pas :
 *
 * - **Un cycle abouti compte sa durée entière, autant de fois qu'il aboutit.**
 *   Le visionnage est l'unité, pas le film : compter le titre une seule fois
 *   rendrait la statistique aveugle au revisionnage, c'est-à-dire à ce que
 *   l'app existe pour capter.
 * - **L'avancement d'un cycle en cours ne compte que sur « tout ».**
 *   `percent` est une valeur d'aujourd'hui, sans date ; la ranger dans une
 *   fenêtre de trente jours reviendrait à lui en inventer une.
 */
export function stats(input: StatsInput): StatsView {
  const rows = filterLibrary(input.states, 'all')
  const accepted = input.period === 'all' ? null : acceptedPrecisions(input.period)

  let movieMinutes = 0
  let seriesMinutes = 0
  let previousMinutes = 0
  let seriesWithoutRuntime = 0
  let movieCount = 0
  let seriesCount = 0
  let rewatches = 0
  let openedCycles = 0
  let finishedCycles = 0
  let episodesSeen = 0

  const ratings: number[] = []
  const genreCounts = new Map<string, number>()
  let mediaWithoutGenres = 0

  for (const row of rows) {
    const media = input.cache.get(row.ref)
    const events = applyVoids(input.eventsByMedia.get(row.ref) ?? [])
    const all = cycles(events)

    openedCycles += all.length
    if (all.length > 1) rewatches += all.length - 1

    const finished = all.filter((cycle) => cycle.hasSeen && !cycle.hasDrop)
    finishedCycles += finished.length

    for (const cycle of finished) {
      if (inCycleWindow(cycle, input.window, accepted)) {
        if (media?.totalRuntime == null) {
          // Un film sans durée est rarissime, une série sans durée est le cas
          // courant : l'exclusion se compte sur les deux, mais elle ne se
          // raconte que pour les séries.
          if (media?.kind !== 'movie') seriesWithoutRuntime += 1
        } else if (media.kind === 'movie') {
          movieMinutes += media.totalRuntime
          movieCount += 1
        } else {
          seriesMinutes += media.totalRuntime
          seriesCount += 1
        }
      }

      if (
        input.previousWindow !== null &&
        inCycleWindow(cycle, input.previousWindow, accepted)
      ) {
        previousMinutes += media?.totalRuntime ?? 0
      }
    }

    // Avancement du cycle en cours : sans date, donc « tout » seulement.
    if (input.period === 'all' && row.status === 'watching' && row.percent > 0) {
      if (media?.totalRuntime != null) {
        const partial = (media.totalRuntime * row.percent) / 100
        if (media.kind === 'movie') movieMinutes += partial
        else seriesMinutes += partial
      } else if (media?.kind !== 'movie') {
        seriesWithoutRuntime += 1
      }
    }

    if (media?.numberOfEpisodes != null && row.percent > 0) {
      episodesSeen += Math.round((media.numberOfEpisodes * row.percent) / 100)
    }

    for (const value of ratingsOfCycles(all, input.window, accepted)) ratings.push(value)

    if (media?.complete && media.genres.length > 0) {
      for (const genre of media.genres) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
      }
    } else {
      mediaWithoutGenres += 1
    }
  }

  return {
    totalMinutes: Math.round(movieMinutes + seriesMinutes),
    movieMinutes: Math.round(movieMinutes),
    seriesMinutes: Math.round(seriesMinutes),
    previousMinutes: input.previousWindow === null ? null : Math.round(previousMinutes),
    seriesWithoutRuntime,
    movieCount,
    seriesCount,
    counts: {
      seen: filterLibrary(rows, 'seen').length,
      watching: filterLibrary(rows, 'watching').length,
      favorites: filterLibrary(rows, 'favorites').length,
    },
    ratings: summarise(ratings),
    completion: openedCycles === 0 ? null : Math.round((finishedCycles / openedCycles) * 100),
    rewatches,
    episodesSeen,
    genres: rankGenres(genreCounts),
    mediaWithoutGenres,
  }
}

/**
 * Précisions assez fines pour entrer dans une fenêtre.
 *
 * Règle du document de design : les agrégations mensuelles excluent les
 * précisions plus grossières que le mois. Généralisée ici — « vu en 2026 »
 * ne peut pas entrer dans une fenêtre de trente jours, parce que rien ne dit
 * que c'était ces trente jours-là. Le compter serait inventer une date.
 */
function acceptedPrecisions(
  period: Exclude<StatsPeriod, 'all'>,
): readonly DatePrecision[] {
  return period === 'month' ? ['exact', 'day'] : ['exact', 'day', 'month']
}

/**
 * Date à laquelle un cycle a été bouclé.
 *
 * Celle du `SEEN` et non la date de rang du cycle : le temps est passé quand
 * le visionnage s'est achevé. Un cycle ouvert en 2019 et fini cette semaine
 * compte pour cette semaine.
 */
function completedAt(cycle: Cycle): StoredEvent | undefined {
  return cycle.events.find((event) => event.type === 'SEEN')
}

function inCycleWindow(
  cycle: Cycle,
  window: StatsWindow | null,
  accepted: readonly DatePrecision[] | null,
): boolean {
  if (window === null || accepted === null) return true

  const event = completedAt(cycle)
  // Sans `SEEN` lisible, on retombe sur la date de rang : classer
  // approximativement vaut mieux que perdre le cycle.
  const at = event?.occurred_at ?? cycle.rankDate
  if (at === null) return false

  if (!accepted.includes(event?.occurred_precision ?? 'exact')) return false

  return at >= window.from && at <= window.to
}

/**
 * Dernière note de chaque cycle, dans la fenêtre.
 *
 * **Par cycle et non par média** : ★3 en 2019 et ★5 en 2026 sur le même
 * titre sont deux notes, et les réduire à une seule effacerait la thèse du
 * produit. `null` est une note effacée par un re-tap sur la même étoile,
 * pas un zéro — la compter comme zéro écraserait la moyenne.
 */
function ratingsOfCycles(
  all: readonly Cycle[],
  window: StatsWindow | null,
  accepted: readonly DatePrecision[] | null,
): readonly number[] {
  const found: number[] = []

  for (const cycle of all) {
    if (!inCycleWindow(cycle, window, accepted)) continue

    let last: StoredEvent | null = null
    for (const event of cycle.events) {
      if (event.type !== 'RATE') continue
      if (last === null || event.created_at >= last.created_at) last = event
    }

    const value = readRating(last)
    if (value !== null) found.push(value)
  }

  return found
}

function readRating(event: StoredEvent | null): number | null {
  if (event === null) return null

  const payload: unknown = (event as { payload?: unknown }).payload
  if (typeof payload !== 'object' || payload === null) return null

  const rating: unknown = (payload as { rating?: unknown }).rating
  return typeof rating === 'number' ? rating : null
}

/** Les trois groupes du donut : ★4-5 menthe, ★3 jaune, ★1-2 rouge. */
function summarise(values: readonly number[]): StatsRatings {
  const total = values.reduce((sum, value) => sum + value, 0)

  return {
    good: values.filter((value) => value >= 4).length,
    mid: values.filter((value) => value === 3).length,
    bad: values.filter((value) => value <= 2).length,
    rated: values.length,
    average: values.length === 0 ? null : Math.round((total / values.length) * 10) / 10,
  }
}

/**
 * Genres du plus fréquent au moins fréquent.
 *
 * Le pourcentage porte sur le total des **mentions** et non des titres : un
 * film à trois genres pèse trois fois. C'est ce qui fait que la somme des
 * barres vaut cent, et donc que les barres se comparent entre elles.
 *
 * Départage par nom à égalité : sans lui, l'ordre viendrait de celui
 * d'insertion et changerait d'un rendu à l'autre.
 */
function rankGenres(counts: ReadonlyMap<string, number>): readonly StatsGenre[] {
  const mentions = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (mentions === 0) return []

  return [...counts.entries()]
    .map(([name, count]) => ({ name, percent: Math.round((count / mentions) * 100) }))
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))
}
