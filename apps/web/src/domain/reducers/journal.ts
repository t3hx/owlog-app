import type { CycleKey, EvenementStocke } from '@/domain/types'

/** Marqueur `— visionnage #N —` ouvrant le bloc d'un cycle. */
export interface MarqueurDeCycle {
  readonly genre: 'marqueur'
  readonly numero: number
  readonly cycle: CycleKey
}

/** Une ligne du journal. */
export interface LigneJournal {
  readonly genre: 'evenement'
  readonly evenement: EvenementStocke
  /** Faux pour un type écrit par une version ultérieure du client. */
  readonly connu: boolean
}

export type EntreeJournal = MarqueurDeCycle | LigneJournal

/**
 * Squelette : le contrat est posé et testé, l'implémentation arrive au
 * commit suivant.
 */
export function journal(_evenements: readonly EvenementStocke[]): readonly EntreeJournal[] {
  throw new Error('Pas encore implémenté')
}
