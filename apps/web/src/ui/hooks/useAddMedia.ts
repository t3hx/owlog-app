import { useCallback, useState } from 'react'

import type { SearchHit } from '@owlog/contracts'

import { systemClock, uuidv7Generator } from '@/adapters/browser/clock'
import { addToLibrary, undo } from '@/domain/commands'
import type { EventId } from '@/domain/types'
import { partialCacheRow } from '@/ports/MediaCache'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Ajout d'un titre en un tap.
 *
 * C'est l'objectif produit central. Le geste écrit **un seul** événement,
 * et la ligne de cache qui permettra de l'afficher hors ligne, dans la
 * même transaction.
 *
 * L'annulation garde l'identifiant de l'événement écrit plutôt que de
 * refaire un calcul : `undo` cible un identifiant précis, ce qui la rend
 * juste même si l'utilisateur a fait autre chose entre-temps.
 */
export function useAddMedia() {
  const { events, deviceId } = usePorts()
  const [lastAdded, setLastAdded] = useState<{ ref: string; eventId: EventId } | null>(null)

  const add = useCallback(
    async (hit: SearchHit) => {
      const produced = addToLibrary({
        events: [],
        mediaRef: hit.ref,
        clock: systemClock,
        ids: uuidv7Generator,
        deviceId,
      })

      const first = produced[0]
      if (!first) return

      await events.append(produced, {
        cacheRows: [partialCacheRow(hit, systemClock.now())],
      })

      setLastAdded({ ref: hit.ref, eventId: first.id })
    },
    [events, deviceId],
  )

  const undoLast = useCallback(async () => {
    if (!lastAdded) return

    await events.append(
      undo(
        {
          events: [],
          mediaRef: lastAdded.ref as SearchHit['ref'],
          clock: systemClock,
          ids: uuidv7Generator,
          deviceId,
        },
        lastAdded.eventId,
      ),
    )

    setLastAdded(null)
  }, [events, lastAdded, deviceId])

  const forget = useCallback(() => setLastAdded(null), [])

  return { add, undoLast, forget, lastAdded }
}
