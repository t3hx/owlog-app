import {
  isKnownEvent,
  opensCycle,
  type CycleKey,
  type DomainEvent,
  type StoredEvent,
  type Timestamp,
} from '@/domain/types'

/**
 * Un cycle de visionnage, avec son rang.
 *
 * `rank` est dérivé, jamais stocké. Le stocker obligerait à renuméroter des
 * événements existants dès qu'un visionnage antérieur est saisi après coup,
 * ce que l'append-only interdit.
 */
export interface Cycle {
  readonly key: CycleKey
  /** `occurred_at` de l'événement d'ouverture. `null` si précision inconnue. */
  readonly rankDate: Timestamp | null
  /** Position chronologique, 1-indexée. C'est le `#N` affiché. */
  readonly rank: number
  readonly events: readonly DomainEvent[]
  readonly hasSeen: boolean
  readonly hasDrop: boolean
  /** Vrai si aucun `START`/`REWATCH` — synchronisation partielle. */
  readonly missingOpening: boolean
}

/**
 * Groupe les événements par cycle et les ordonne par rang.
 *
 * **La date de rang d'un cycle est l'`occurred_at` de son événement
 * d'ouverture.** Une seule définition, trois consommateurs : la
 * numérotation `#N`, la dérivation du statut, le tri du journal.
 *
 * Départage : date de rang, puis `created_at`, puis `id`. Nécessaire et pas
 * théorique — vingt titres rétro-datés à l'année produisent des dates
 * identiques, et sans départage le `#N` affiché serait non déterministe
 * d'un rendu à l'autre.
 *
 * Les cycles sans date (précision `unknown`) passent **avant** tous les
 * autres : « je ne sais plus quand » est nécessairement plus ancien que
 * n'importe quelle date connue, sans quoi ils s'intercaleraient au hasard.
 *
 * Les types inconnus sont ignorés, jamais une exception : au temps 2, deux
 * appareils tourneront sur deux versions du client.
 */
export function cycles(events: readonly StoredEvent[]): readonly Cycle[] {
  const byCycle = new Map<CycleKey, DomainEvent[]>()

  for (const event of events) {
    if (!isKnownEvent(event)) continue
    if (event.cycle_key === null) continue

    const existing = byCycle.get(event.cycle_key)
    if (existing) {
      existing.push(event)
    } else {
      byCycle.set(event.cycle_key, [event])
    }
  }

  const built = [...byCycle.entries()].map(([key, cycleEvents]) =>
    buildCycle(key, cycleEvents),
  )

  built.sort(compareByRank)

  return built.map((cycle, index) => ({ ...cycle, rank: index + 1 }))
}

/** Ce qui sert à ordonner, avant que le rang final ne soit attribué. */
type UnrankedCycle = Omit<Cycle, 'rank'> & {
  /** Retenu pour le départage : `created_at` de l'événement d'ouverture. */
  readonly writtenAt: Timestamp
  readonly openingId: string
}

function buildCycle(key: CycleKey, events: DomainEvent[]): UnrankedCycle & { rank: number } {
  const opening = events.find(opensCycle)

  // Sans événement d'ouverture — synchronisation partielle — on retient le
  // plus ancien événement écrit du cycle. La donnée de l'utilisateur est
  // conservée et classée approximativement, plutôt que perdue.
  const reference =
    opening ??
    [...events].sort((a, b) => compareStrings(a.created_at, b.created_at))[0]

  if (!reference) {
    throw new Error(`Cycle ${key} has no events at all, which cannot happen`)
  }

  return {
    key,
    rankDate: reference.occurred_at,
    rank: 0,
    events,
    hasSeen: events.some((e) => e.type === 'SEEN'),
    hasDrop: events.some((e) => e.type === 'DROP'),
    missingOpening: opening === undefined,
    writtenAt: reference.created_at,
    openingId: reference.id,
  }
}

function compareByRank(a: UnrankedCycle, b: UnrankedCycle): number {
  if (a.rankDate === null && b.rankDate !== null) return -1
  if (a.rankDate !== null && b.rankDate === null) return 1

  if (a.rankDate !== null && b.rankDate !== null) {
    const byDate = compareStrings(a.rankDate, b.rankDate)
    if (byDate !== 0) return byDate
  }

  const byWrite = compareStrings(a.writtenAt, b.writtenAt)
  if (byWrite !== 0) return byWrite

  return compareStrings(a.openingId, b.openingId)
}

/**
 * Compare deux horodatages ISO 8601 en UTC.
 *
 * Comparaison lexicographique et non `Date.parse` : le format ISO en UTC
 * est trié correctement tel quel, et parser reviendrait à faire confiance
 * au fuseau du navigateur pour une donnée qui n'en dépend pas.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
