import type { CycleKey, EvenementStocke, Horodatage } from '@/domain/types'

/** Avancement dans le cycle courant. */
export interface Progression {
  readonly pourcentage: number
  readonly label: string | null
  /** Le label décrit un point plus ancien que la progression affichée. */
  readonly perime: boolean
  readonly majLe: Horodatage | null
}

/**
 * Squelettes : les contrats sont posés et testés, les implémentations
 * arrivent au commit suivant.
 */
export function nombreDeVisionnages(_evenements: readonly EvenementStocke[]): number {
  throw new Error('Pas encore implémenté')
}

export function progression(_evenements: readonly EvenementStocke[]): Progression {
  throw new Error('Pas encore implémenté')
}

export function note(
  _evenements: readonly EvenementStocke[],
  _cycle: CycleKey,
): number | null {
  throw new Error('Pas encore implémenté')
}

export function commentaire(
  _evenements: readonly EvenementStocke[],
  _cycle: CycleKey,
): string | null {
  throw new Error('Pas encore implémenté')
}

export function estCoupDeCoeur(_evenements: readonly EvenementStocke[]): boolean {
  throw new Error('Pas encore implémenté')
}
