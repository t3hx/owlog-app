import { useEffect, useMemo, useRef, useState } from 'react'

import { stats, type StatsMedia, type StatsPeriod, type StatsView, type StatsWindow, type MediaRef, type StoredEvent, type Timestamp } from '@owlog/domain'
import { usePorts } from '@/ui/PortsProvider'

const DAY_MS = 86_400_000
const WINDOW_DAYS: Record<Exclude<StatsPeriod, 'all'>, number> = { month: 30, year: 365 }

/**
 * Toutes les valeurs de l'écran de stats.
 *
 * **C'est le seul écran qui lit le journal entier**, et c'est assumé : une
 * agrégation ne peut pas se calculer sur une page. Il le fait par une
 * requête indexée par média — `eventsForMedia` — et non par un vidage, ce
 * qui est exactement la forme que le port promet de tenir sur Postgres. Le
 * même chemin sert déjà `/debug`.
 *
 * Les bornes de période sont calculées ici et pas dans le réducteur : le
 * domaine n'a pas le droit de connaître `Date`, et une arithmétique de
 * calendrier réclamerait précisément ce qu'on lui interdit.
 */
export function useStats(period: StatsPeriod): { view: StatsView | null; loading: boolean } {
  const { events, live } = usePorts()
  const states = live.useMediaStates()
  const cacheRows = live.useMediaCacheRows()

  const [eventsByMedia, setEventsByMedia] = useState<ReadonlyMap<
    MediaRef,
    readonly StoredEvent[]
  > | null>(null)

  // Les références de la bibliothèque, en une chaîne stable : c'est ce qui
  // permet de ne relire le journal que quand la bibliothèque change, et non
  // à chaque rendu déclenché par le sélecteur de période.
  const refs = states.map((row) => row.ref).sort().join('|')
  const loaded = useRef<string | null>(null)

  useEffect(() => {
    if (loaded.current === refs) return
    loaded.current = refs

    let cancelled = false

    void (async () => {
      const collected = new Map<MediaRef, readonly StoredEvent[]>()
      for (const row of states) {
        collected.set(row.ref, await events.eventsForMedia(row.ref))
      }
      if (!cancelled) setEventsByMedia(collected)
    })()

    return () => {
      cancelled = true
    }
    // `states` est volontairement absent : `refs` en est la forme stable, et
    // le tableau change d'identité à chaque lecture réactive.
  }, [refs, events, states])

  const cache = useMemo(() => {
    const map = new Map<MediaRef, StatsMedia>()
    for (const row of cacheRows) {
      map.set(row.ref, {
        kind: row.kind === 'tv' ? 'tv' : 'movie',
        totalRuntime: row.totalRuntime,
        numberOfEpisodes: row.numberOfEpisodes,
        genres: row.genres,
        complete: row.complete,
      })
    }
    return map
  }, [cacheRows])

  const view = useMemo(() => {
    if (eventsByMedia === null) return null

    const [window, previousWindow] = windowsFor(period, new Date())
    return stats({ states, eventsByMedia, cache, period, window, previousWindow })
  }, [eventsByMedia, states, cache, period])

  return { view, loading: eventsByMedia === null }
}

/**
 * Fenêtre retenue, et la précédente de même longueur.
 *
 * La précédente est collée à la première : c'est ce qui rend le delta
 * lisible — « ces trente jours contre les trente d'avant ». Sur « tout », il
 * n'y a rien avant, donc pas de delta plutôt qu'un delta nul, qui
 * laisserait croire à une période blanche.
 */
export function windowsFor(
  period: StatsPeriod,
  now: Date,
): readonly [StatsWindow | null, StatsWindow | null] {
  if (period === 'all') return [null, null]

  const span = WINDOW_DAYS[period] * DAY_MS
  const end = now.getTime()
  const start = end - span

  return [
    { from: iso(start), to: iso(end) },
    { from: iso(start - span), to: iso(start) },
  ]
}

function iso(time: number): Timestamp {
  return new Date(time).toISOString() as Timestamp
}
