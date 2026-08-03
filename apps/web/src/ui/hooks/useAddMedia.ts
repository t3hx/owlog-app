import { useCallback, useState } from 'react'

import type { SearchHit } from '@owlog/contracts'

import { systemClock, uuidv7Generator } from '@/adapters/browser/clock'
import {
  addToLibrary,
  setStatus,
  toggleFavorite,
  undo,
  type CommandContext,
  type DomainEvent,
  type EventId,
} from '@owlog/domain'
import { partialCacheRow } from '@/ports/MediaCache'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Ajout d'un titre en un tap.
 *
 * C'est l'objectif produit central. Le geste écrit ses événements et la ligne
 * de cache qui permettra de l'afficher hors ligne, dans la même transaction.
 *
 * Trois gestes, tous locaux — aucun ne touche le réseau, donc tous marchent
 * hors-ligne exactement comme le `+` historique :
 *
 * - `add` : le `+`, un seul `WATCH`, le titre entre en « à voir » ;
 * - `addFavorite` : le ♥, un cycle complet daté du jour **puis** `FAV`.
 *   Décision utilisateur (2026-08-01) : un coup de cœur est un titre déjà
 *   vu — le geste écrit donc « vu aujourd'hui », jamais « à voir ». Et
 *   jamais `FAV` seul : le marqueur suppose le titre en bibliothèque ;
 * - `addStarted` : le ▶, `WATCH` + `START` en un lot — c'est ce que
 *   `setStatus(…, 'watching')` produit sur un titre absent. Adaptatif comme le
 *   play : série ou film, le geste ouvre un cycle ; un film ouvert se marquera
 *   vu plus tard, d'un tap sur le play de l'accueil.
 *
 * L'annulation garde les identifiants des événements écrits plutôt que de
 * refaire un calcul : `undo` cible des identifiants précis, ce qui la rend
 * juste même si l'utilisateur a fait autre chose entre-temps. Un geste rapide
 * écrit plusieurs événements, donc l'annulation les vise **tous** — annuler le
 * seul `WATCH` laisserait un `FAV` ou un `START` orphelin sur un titre retiré.
 */
export function useAddMedia() {
  const { events, deviceId } = usePorts()
  const [lastAdded, setLastAdded] = useState<{
    ref: string
    eventIds: readonly EventId[]
  } | null>(null)

  const write = useCallback(
    async (hit: SearchHit, command: (context: CommandContext) => readonly DomainEvent[]) => {
      const produced = command({
        events: [],
        mediaRef: hit.ref,
        clock: systemClock,
        ids: uuidv7Generator,
        deviceId,
      })

      if (produced.length === 0) return

      await events.append(produced, {
        cacheRows: [partialCacheRow(hit, systemClock.now())],
      })

      setLastAdded({ ref: hit.ref, eventIds: produced.map((event) => event.id) })
    },
    [events, deviceId],
  )

  /** Le `+` : ajoute en « à voir ». */
  const add = useCallback((hit: SearchHit) => write(hit, addToLibrary), [write])

  /** Le ♥ : ajoute en « vu » daté du jour **et** marque le coup de cœur. */
  const addFavorite = useCallback(
    (hit: SearchHit) =>
      write(hit, (context) => {
        // Un coup de cœur suppose un visionnage : `setStatus(…, 'seen')` sur
        // un titre absent produit le cycle complet daté d'aujourd'hui.
        const seen = setStatus(context, 'seen')
        // `toggleFavorite` relit le journal pour choisir `FAV` ou `UNFAV` :
        // lui donner le cycle qui vient d'être produit garantit un `FAV`
        // sur un titre bien en bibliothèque.
        return [...seen, ...toggleFavorite({ ...context, events: seen })]
      }),
    [write],
  )

  /** Le ▶ : ajoute directement « en cours » — `WATCH` + `START` en un lot. */
  const addStarted = useCallback(
    (hit: SearchHit) => write(hit, (context) => setStatus(context, 'watching')),
    [write],
  )

  const undoLast = useCallback(async () => {
    if (!lastAdded) return

    const context: CommandContext = {
      events: [],
      mediaRef: lastAdded.ref as SearchHit['ref'],
      clock: systemClock,
      ids: uuidv7Generator,
      deviceId,
    }

    await events.append(lastAdded.eventIds.flatMap((id) => undo(context, id)))

    setLastAdded(null)
  }, [events, lastAdded, deviceId])

  const forget = useCallback(() => setLastAdded(null), [])

  return { add, addFavorite, addStarted, undoLast, forget, lastAdded }
}
