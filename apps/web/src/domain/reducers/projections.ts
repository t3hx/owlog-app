import { applyVoids } from '@/domain/reducers/applyVoids'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { currentStatus } from '@/domain/rules/status'
import {
  isKnownEvent,
  type CycleKey,
  type DomainEvent,
  type StoredEvent,
  type Timestamp,
} from '@/domain/types'

/** Avancement dans le cycle courant. */
export interface Progress {
  readonly percent: number
  readonly label: string | null
  /** Le label décrit un point plus ancien que la progression affichée. */
  readonly stale: boolean
  readonly updatedAt: Timestamp | null
}

const NO_PROGRESS: Progress = {
  percent: 0,
  label: null,
  stale: false,
  updatedAt: null,
}

/**
 * Nombre de visionnages aboutis.
 *
 * Un cycle contenant `SEEN` **et** `DROP` ne compte pas : c'est le mis-tap
 * sur la pastille, où un abandon atterrit sur un cycle qui portait déjà sa
 * fin. Sans cette règle, un titre affiché `✕ abandonné` porterait un
 * compteur de visionnages incrémenté.
 */
export function seenCount(events: readonly StoredEvent[]): number {
  return activeCycles(events).filter((cycle) => cycle.hasSeen && !cycle.hasDrop).length
}

/**
 * Avancement dans le cycle courant.
 *
 * Rend `0` quand le statut vaut « à voir » : après un bouclage de pastille,
 * le cycle courant reste l'ancien cycle abandonné, et afficher sa
 * progression sur un titre remis à « à voir » serait faux.
 */
export function progress(events: readonly StoredEvent[]): Progress {
  if (currentStatus(events) === 'to-watch') return NO_PROGRESS

  const current = currentCycle(events)
  if (!current) return NO_PROGRESS

  const last = lastOfType(current.events, 'PROG')
  if (!last || last.type !== 'PROG') return NO_PROGRESS

  const label = last.payload.label ?? null
  const labelSetAt = last.payload.label_created_at ?? null

  return {
    percent: last.payload.percent,
    label,
    // Le label a été saisi avant l'événement de progression qui le porte :
    // il décrit un point plus ancien que l'avancement affiché.
    stale: labelSetAt !== null && labelSetAt < last.created_at,
    updatedAt: last.created_at,
  }
}

/**
 * Note d'un cycle précis.
 *
 * Par cycle et non par média : c'est la thèse du produit, ★3 en 2019 et ★5
 * en 2026 sur le même titre. `null` couvre deux cas indistinguables pour
 * l'affichage — jamais noté, ou note effacée par un re-tap sur la même
 * étoile.
 */
export function rating(
  events: readonly StoredEvent[],
  cycle: CycleKey,
): number | null {
  const last = lastOfTypeInCycle(events, cycle, 'RATE')
  if (!last || last.type !== 'RATE') return null
  return last.payload.rating
}

/** Dernier commentaire d'un cycle. */
export function comment(
  events: readonly StoredEvent[],
  cycle: CycleKey,
): string | null {
  const last = lastOfTypeInCycle(events, cycle, 'NOTE')
  if (!last || last.type !== 'NOTE') return null
  return last.payload.text
}

/**
 * Coup de cœur.
 *
 * Marqueur transversal, cumulable avec les quatre statuts : il ne remplace
 * jamais la pastille. Départagé par `created_at` et non par la position
 * dans le tableau, qui n'a aucune garantie d'ordre.
 */
export function isFavorite(events: readonly StoredEvent[]): boolean {
  let last: DomainEvent | null = null

  for (const event of applyVoids(events)) {
    if (!isKnownEvent(event)) continue
    if (event.type !== 'FAV' && event.type !== 'UNFAV') continue
    if (last === null || event.created_at >= last.created_at) {
      last = event
    }
  }

  return last?.type === 'FAV'
}

function activeCycles(events: readonly StoredEvent[]): readonly Cycle[] {
  return cycles(applyVoids(events))
}

function currentCycle(events: readonly StoredEvent[]): Cycle | undefined {
  const all = activeCycles(events)
  return all[all.length - 1]
}

/** Dernier événement d'un type donné, par ordre d'écriture. */
function lastOfType(
  events: readonly DomainEvent[],
  type: DomainEvent['type'],
): DomainEvent | undefined {
  let found: DomainEvent | undefined
  for (const event of events) {
    if (event.type !== type) continue
    if (!found || event.created_at >= found.created_at) {
      found = event
    }
  }
  return found
}

function lastOfTypeInCycle(
  events: readonly StoredEvent[],
  cycle: CycleKey,
  type: DomainEvent['type'],
): DomainEvent | undefined {
  const found = activeCycles(events).find((candidate) => candidate.key === cycle)
  if (!found) return undefined
  return lastOfType(found.events, type)
}
