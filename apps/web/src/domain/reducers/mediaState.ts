import { applyVoids } from '@/domain/reducers/applyVoids'
import {
  comment,
  isFavorite,
  seenCount,
  rating as ratingOfCycle,
  progress,
} from '@/domain/reducers/projections'
import { cycles } from '@/domain/rules/cycles'
import { currentStatus } from '@/domain/rules/status'
import type {
  CycleKey,
  MediaStatus,
  StoredEvent,
  Timestamp,
  MediaRef,
  Status,
} from '@/domain/types'

/** Une ligne de la table dérivée `media_state`. */
export interface MediaStateRow {
  readonly ref: MediaRef
  readonly status: MediaStatus
  readonly percent: number
  readonly label: string | null
  readonly labelStale: boolean
  readonly rating: number | null
  readonly comment: string | null
  readonly favorite: boolean
  readonly seenCount: number
  readonly currentCycle: CycleKey | null
  readonly updatedAt: Timestamp | null
}

/** Une chip de filtre de la bibliothèque. */
export type LibraryFilter = Status | 'all' | 'favorites'

/** Les six chips, dans l'ordre du handoff. */
export const LIBRARY_FILTERS: readonly LibraryFilter[] = [
  'all',
  'to-watch',
  'watching',
  'seen',
  'dropped',
  'favorites',
]

export interface LibraryView {
  readonly rows: readonly MediaStateRow[]
  readonly counts: Record<LibraryFilter, number>
}

/**
 * Unique producteur de la table `media_state`.
 *
 * Recalculé à chaque `append` concernant ce média, par le domaine et jamais
 * par l'adaptateur : sinon la règle de dérivation du statut existerait à
 * deux endroits.
 *
 * La fonction est pure et indépendante de l'ordre du tableau d'entrée, ce
 * qui est la propriété qui rend la reconstruction intégrale possible :
 * rejouer tout le store doit produire exactement l'état accumulé événement
 * par événement.
 */
export function mediaState(
  events: readonly StoredEvent[],
  ref: MediaRef,
): MediaStateRow {
  const active = applyVoids(events)
  const allCycles = cycles(active)
  const current = allCycles[allCycles.length - 1] ?? null
  const progressValue = progress(events)

  return {
    ref,
    status: currentStatus(events),
    percent: progressValue.percent,
    label: progressValue.label,
    labelStale: progressValue.stale,
    rating: current ? ratingOfCycle(events, current.key) : null,
    comment: current ? comment(events, current.key) : null,
    favorite: isFavorite(events),
    seenCount: seenCount(events),
    currentCycle: current?.key ?? null,
    updatedAt: lastWrittenAt(active),
  }
}

/**
 * Projection de la bibliothèque.
 *
 * Consomme des lignes `media_state`, jamais le journal brut : c'est ce qui
 * permet au port `EventStore` de rester en forme de requêtes plutôt qu'en
 * forme de vidage, et donc à la promesse Postgres de tenir.
 */
export function library(states: readonly MediaStateRow[]): LibraryView {
  const rows = inLibrary(states)

  return {
    rows,
    // Comptés **par le filtre lui-même**, jamais par un prédicat parallèle.
    // C'est ce qui interdit à une chip d'annoncer trois titres au-dessus
    // d'une liste qui en montre deux.
    counts: {
      all: rows.length,
      'to-watch': filterLibrary(rows, 'to-watch').length,
      watching: filterLibrary(rows, 'watching').length,
      seen: filterLibrary(rows, 'seen').length,
      dropped: filterLibrary(rows, 'dropped').length,
      favorites: filterLibrary(rows, 'favorites').length,
    },
  }
}

/**
 * Lignes retenues par une chip de filtre.
 *
 * **Le coup de cœur n'est pas un statut** : il se cumule avec les quatre,
 * donc il se filtre à part et la somme des chips dépasse `tous`.
 *
 * Vit dans le domaine et non dans l'écran parce que le compteur d'une chip
 * et la liste qu'elle ouvre doivent sortir du même prédicat. Deux
 * implémentations divergeraient, et l'écart se lirait comme une perte de
 * données plutôt que comme un défaut d'affichage.
 */
export function filterLibrary(
  states: readonly MediaStateRow[],
  filter: LibraryFilter,
): readonly MediaStateRow[] {
  const rows = inLibrary(states)

  if (filter === 'all') return rows
  if (filter === 'favorites') return rows.filter((row) => row.favorite)

  return rows.filter((row) => row.status === filter)
}

/** Un média retiré n'est dans aucune chip, pas même dans « tous ». */
function inLibrary(states: readonly MediaStateRow[]): readonly MediaStateRow[] {
  return states.filter((row) => row.status !== 'absent')
}

/** Sous-ligne `› N en cours · N à voir` de l'accueil. */
export function homeCounters(states: readonly MediaStateRow[]): {
  watching: number
  toWatch: number
} {
  // Même prédicat que les chips de la bibliothèque : la sous-ligne de
  // l'accueil et la chip `● en cours` ne peuvent pas annoncer deux nombres
  // différents pour la même chose.
  return {
    watching: filterLibrary(states, 'watching').length,
    toWatch: filterLibrary(states, 'to-watch').length,
  }
}

function lastWrittenAt(events: readonly StoredEvent[]): Timestamp | null {
  let last: Timestamp | null = null
  for (const event of events) {
    if (last === null || event.created_at > last) last = event.created_at
  }
  return last
}
