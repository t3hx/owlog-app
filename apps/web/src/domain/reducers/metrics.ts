import { applyVoids } from '@/domain/reducers/applyVoids'
import { journal } from '@/domain/reducers/journal'
import { cycles } from '@/domain/rules/cycles'
import { isKnownEvent, type StoredEvent, type MediaRef, type Timestamp } from '@/domain/types'

/**
 * Métriques de diagnostic.
 *
 * Les deux premières viennent du plan et servent à répondre à une question
 * précise : le moment fort du produit a-t-il jamais été déclenché ? Si
 * `cyclesBeyondFirst` reste à zéro après deux semaines d'usage, le
 * produit livré n'est qu'une watchlist de plus, et le rétro-datage n'a
 * servi à rien.
 *
 * La troisième existe parce que les réducteurs ignorent silencieusement les
 * types qu'ils ne connaissent pas. Sans ce compteur, « ignorer » voudrait
 * dire « perdre » : c'est le seul endroit où l'on découvre qu'une version
 * du client a déposé des données qu'une autre ne lit pas.
 */
export interface Metrics {
  readonly mediaCount: number
  /** Visionnages au-delà du firstAt, tous médias confondus. */
  readonly cyclesBeyondFirst: number
  readonly journalEntries: number
  /** Bornes du journal. L'appelant en tire les jours écoulés. */
  readonly firstAt: Timestamp | null
  readonly lastAt: Timestamp | null
  readonly unknownEvents: readonly { type: string; count: number }[]
  readonly voidedEvents: number
}

export function metrics(
  eventsByMedia: ReadonlyMap<MediaRef, readonly StoredEvent[]>,
): Metrics {
  let cyclesBeyondFirst = 0
  let journalEntries = 0
  let voidedEvents = 0
  const unknown = new Map<string, number>()

  let firstAt: Timestamp | null = null
  let lastAt: Timestamp | null = null

  for (const events of eventsByMedia.values()) {
    const active = applyVoids(events)
    voidedEvents += events.length - active.length

    const cycleCount = cycles(active).length
    if (cycleCount > 1) cyclesBeyondFirst += cycleCount - 1

    journalEntries += journal(events).filter((e) => e.kind === 'event').length

    for (const event of events) {
      if (!isKnownEvent(event)) {
        unknown.set(event.type, (unknown.get(event.type) ?? 0) + 1)
      }
      if (firstAt === null || event.created_at < firstAt) {
        firstAt = event.created_at
      }
      if (lastAt === null || event.created_at > lastAt) {
        lastAt = event.created_at
      }
    }
  }

  return {
    mediaCount: eventsByMedia.size,
    cyclesBeyondFirst,
    journalEntries,
    firstAt,
    lastAt,
    unknownEvents: [...unknown.entries()].map(([type, count]) => ({ type, count })),
    voidedEvents,
  }
}

/**
 * Entrées par jour d'usage.
 *
 * Le dénominateur est **borné à un jour minimum**. Diviser par une durée
 * plus courte gonflerait la métrique le premier soir, et donnerait une
 * impression d'usage soutenu au moment précis où l'on cherche à savoir si
 * l'habitude se prend.
 *
 * Prend des jours déjà comptés et non deux horodatages : convertir deux
 * dates en durée demande `Date`, que le domaine n'a pas le droit de
 * connaître — c'est ce qui le garde déterministe. Le calendrier est
 * l'affaire de l'appelant, comme pour les fenêtres de l'écran de stats.
 */
export function entriesPerDay(entries: number, elapsedDays: number): number {
  if (entries === 0) return 0

  const days = Math.max(1, elapsedDays)
  return Math.round((entries / days) * 10) / 10
}
