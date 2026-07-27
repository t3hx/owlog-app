import type { CycleKey, Evenement, EvenementStocke, Horodatage } from '@/domain/types'

/**
 * Un cycle de visionnage.
 *
 * Squelette : le contrat est posé et testé, l'implémentation arrive au
 * commit suivant.
 */
export interface Cycle {
  readonly key: CycleKey
  readonly dateDeRang: Horodatage | null
  readonly rang: number
  readonly evenements: readonly Evenement[]
  readonly aSeen: boolean
  readonly aDrop: boolean
  readonly ouvertureManquante: boolean
}

export function cycles(_evenements: readonly EvenementStocke[]): readonly Cycle[] {
  throw new Error('Pas encore implémenté')
}
