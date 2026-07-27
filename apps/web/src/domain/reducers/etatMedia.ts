import type {
  CycleKey,
  EtatMedia,
  EvenementStocke,
  Horodatage,
  MediaRef,
  Statut,
} from '@/domain/types'

/** Une ligne de la table dérivée `media_state`. */
export interface LigneEtat {
  readonly ref: MediaRef
  readonly statut: EtatMedia
  readonly pourcentage: number
  readonly label: string | null
  readonly labelPerime: boolean
  readonly note: number | null
  readonly coupDeCoeur: boolean
  readonly nombreDeVisionnages: number
  readonly cycleCourant: CycleKey | null
  readonly majLe: Horodatage | null
}

export interface VueBibliotheque {
  readonly lignes: readonly LigneEtat[]
  readonly compteurs: Record<Statut | 'tous' | 'coupsDeCoeur', number>
}

/**
 * Squelettes : les contrats sont posés et testés, les implémentations
 * arrivent au commit suivant.
 */
export function etatMedia(_evenements: readonly EvenementStocke[], _ref: MediaRef): LigneEtat {
  throw new Error('Pas encore implémenté')
}

export function bibliotheque(_etats: readonly LigneEtat[]): VueBibliotheque {
  throw new Error('Pas encore implémenté')
}

export function compteursAccueil(_etats: readonly LigneEtat[]): {
  enCours: number
  aVoir: number
} {
  throw new Error('Pas encore implémenté')
}
