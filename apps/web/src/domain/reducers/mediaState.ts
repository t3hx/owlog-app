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
  readonly note: number | null
  readonly comment: string | null
  readonly favorite: boolean
  readonly seenCount: number
  readonly currentCycle: CycleKey | null
  readonly updatedAt: Timestamp | null
}

export interface LibraryView {
  readonly rows: readonly MediaStateRow[]
  readonly counts: Record<Status | 'all' | 'favorites', number>
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
    note: current ? ratingOfCycle(events, current.key) : null,
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
  const rows = states.filter((etat) => etat.status !== 'absent')

  return {
    rows,
    counts: {
      all: rows.length,
      'to-watch': countBy(rows, 'to-watch'),
      'watching': countBy(rows, 'watching'),
      seen: countBy(rows, 'seen'),
      dropped: countBy(rows, 'dropped'),
      // Le coup de cœur n'est pas un statut : il se cumule avec les quatre,
      // donc il se compte à part et la somme des chips dépasse `all`.
      favorites: rows.filter((etat) => etat.favorite).length,
    },
  }
}

/** Sous-ligne `› N en cours · N à voir` de l'accueil. */
export function homeCounters(states: readonly MediaStateRow[]): {
  enCours: number
  aVoir: number
} {
  const rows = states.filter((etat) => etat.status !== 'absent')
  return {
    enCours: countBy(rows, 'watching'),
    aVoir: countBy(rows, 'to-watch'),
  }
}

function countBy(rows: readonly MediaStateRow[], status: Status): number {
  return rows.filter((row) => row.status === status).length
}

function lastWrittenAt(events: readonly StoredEvent[]): Timestamp | null {
  let last: Timestamp | null = null
  for (const event of events) {
    if (last === null || event.created_at > last) last = event.created_at
  }
  return last
}
