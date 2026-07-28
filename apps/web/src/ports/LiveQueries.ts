import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { MediaRef, StoredEvent } from '@/domain/types'
import type { MediaCacheRow } from '@/ports/MediaCache'
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

  /**
   * Journal d'un média, réactif.
   *
   * La page média en a besoin brut : le journal groupe par cycle et l'appui
   * long annule une entrée précise, deux choses qu'une ligne dérivée ne peut
   * pas porter.
   */
  useMediaEvents(ref: MediaRef): readonly StoredEvent[]

  /**
   * Ligne dérivée d'un média, réactive.
   *
   * L'en-tête et les étoiles la lisent plutôt que de recalculer depuis les
   * événements : c'est le même chemin que la bibliothèque, donc les deux
   * écrans ne peuvent pas afficher deux statuts différents.
   */
  useMediaState(ref: MediaRef): MediaStateRow | undefined

  /** Ligne de cache d'un média, réactive : titre, affiche, genres, durée. */
  useMediaCacheRow(ref: MediaRef): MediaCacheRow | undefined

  /**
   * Tout le cache, réactif.
   *
   * L'accueil affiche deux listes de titres et d'affiches, et les hooks ne
   * s'appellent pas dans une boucle : une lecture par média est impossible
   * là où le nombre de médias change à chaque ajout.
   */
  useMediaCacheRows(): readonly MediaCacheRow[]
}
