import type { Evenement, EvenementStocke, MediaRef, Precision } from '@/domain/types'
import type { GenerateurId, Horloge } from '@/ports/Horloge'

/**
 * Contexte d'exécution d'une commande.
 *
 * Une commande est une fonction pure : elle reçoit l'état existant et les
 * ports dont elle a besoin, et rend les événements à écrire. Elle n'écrit
 * rien elle-même — c'est l'appelant qui les passe au store, dans une seule
 * transaction.
 */
export interface Contexte {
  readonly evenements: readonly EvenementStocke[]
  readonly mediaRef: MediaRef
  readonly horloge: Horloge
  readonly ids: GenerateurId
}

/** Saisie d'un visionnage passé. */
export interface SaisieRetro {
  readonly date: string | null
  readonly precision: Precision
  readonly note?: number | null
  readonly commentaire?: string
}

/**
 * Squelettes : les contrats sont posés et testés, les implémentations
 * arrivent au commit suivant.
 */
export function ajouter(_contexte: Contexte): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function avancerStatut(_contexte: Contexte): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function progresser(
  _contexte: Contexte,
  _options: { increment: number; label?: string },
): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function retroDater(
  _contexte: Contexte,
  _saisie: SaisieRetro,
): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function revoir(_contexte: Contexte): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function noter(_contexte: Contexte, _note: number | null): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function commenter(_contexte: Contexte, _texte: string): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function basculerCoupDeCoeur(_contexte: Contexte): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function retirer(_contexte: Contexte): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}

export function annuler(_contexte: Contexte, _cible: string): readonly Evenement[] {
  throw new Error('Pas encore implémenté')
}
