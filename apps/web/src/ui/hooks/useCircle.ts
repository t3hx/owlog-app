import { useCallback, useEffect, useState } from 'react'

import type { FriendsResponse } from '@owlog/contracts'

import type { SocialFailure } from '@/ports/SocialGateway'
import { usePorts } from '@/ui/PortsProvider'

export type CircleState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly circle: FriendsResponse }
  | { readonly status: 'failed'; readonly failure: SocialFailure }

/**
 * Amis et demandes reçues — l'écran 8 en un appel.
 *
 * **Données de session, jamais persistées.** `media_cache` reste la seule
 * source hors-ligne du produit ; recopier ici la liste d'amis dans Dexie
 * créerait une seconde source de vérité sociale, qui vieillirait en silence
 * et afficherait comme ami quelqu'un qui ne l'est plus. Hors-ligne, l'écran
 * dit qu'il ne sait pas — même politique que la recherche média, qui ne sert
 * pas davantage ses résultats depuis un cache.
 *
 * `reload` est exposé parce que accepter ou refuser une demande change deux
 * listes à la fois : la demande quitte l'une et l'ami entre dans l'autre.
 * Recalculer localement les deux effets dupliquerait la règle du serveur —
 * et divergerait le jour d'une demande croisée, où accepter n'était même pas
 * nécessaire.
 */
export function useCircle(): {
  readonly state: CircleState
  readonly reload: () => Promise<void>
} {
  const { social } = usePorts()
  const [state, setState] = useState<CircleState>({ status: 'loading' })

  const load = useCallback(async () => {
    const result = await social.circle()
    setState(
      result.ok
        ? { status: 'ready', circle: result.value }
        : { status: 'failed', failure: result.failure },
    )
  }, [social])

  useEffect(() => {
    let cancelled = false

    void social.circle().then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', circle: result.value }
          : { status: 'failed', failure: result.failure },
      )
    })

    return () => {
      cancelled = true
    }
  }, [social])

  return { state, reload: load }
}
