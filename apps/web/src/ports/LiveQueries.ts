import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { PendingAdd } from '@/ports/PendingAdds'

/**
 * Lectures réactives.
 *
 * L'UI a besoin de se recalculer quand le stockage change. Sans ce port,
 * chaque écran importerait le hook de l'adaptateur, et l'architecture
 * hexagonale ne tiendrait plus qu'à la discipline — alors qu'ici elle tient
 * à une règle de lint qui échoue.
 *
 * Ce sont des hooks React et non des promesses : la réactivité est le sujet,
 * et un port qui rendrait des promesses obligerait l'UI à réimplémenter
 * l'abonnement.
 */
export interface LiveQueries {
  useMediaStates(): readonly MediaStateRow[]
  usePendingAdds(): readonly PendingAdd[]
}
