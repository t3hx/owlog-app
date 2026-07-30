import { useCallback } from 'react'

import { systemClock, uuidv7Generator } from '@/adapters/browser/clock'
import { advanceStatus, setStatus, type CommandContext } from '@/domain/commands'
import type { DomainEvent, MediaRef, Status } from '@/domain/types'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Gestes de statut, depuis une liste.
 *
 * La page média a `useMedia`, qui tient les événements d'un seul titre par
 * lecture réactive. Une liste ne peut pas faire ça : les hooks ne s'appellent
 * pas dans une boucle, et le nombre de titres change à chaque ajout. Le
 * journal du média est donc relu **au moment d'écrire**, ce qui a l'avantage
 * d'être juste même si un autre écran a écrit entre-temps.
 *
 * Aucune règle ici : `advanceStatus` et `setStatus` vivent dans
 * `domain/commands/`, avec leurs pièges — un cycle clos ne se rouvre jamais,
 * le retour à « à voir » est un `WATCH` hors cycle.
 */
export function useStatusActions() {
  const { events, deviceId } = usePorts()

  const write = useCallback(
    async (
      ref: MediaRef,
      command: (context: CommandContext) => readonly DomainEvent[],
    ): Promise<void> => {
      const stored = await events.eventsForMedia(ref)
      const produced = command({
        events: stored,
        mediaRef: ref,
        clock: systemClock,
        ids: uuidv7Generator,
        deviceId,
      })

      if (produced.length === 0) return
      await events.append(produced)
    },
    [events, deviceId],
  )

  return {
    /** Tap sur la pastille : un cran dans la boucle. */
    cycle: (ref: MediaRef) => write(ref, advanceStatus),
    /** Choix direct depuis le menu de l'appui long. */
    pick: (ref: MediaRef, target: Status) => write(ref, (c) => setStatus(c, target)),
  }
}
