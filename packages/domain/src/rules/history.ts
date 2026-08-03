import type { StoredEvent, Timestamp } from '../types.ts'

/**
 * Ce qui se raconte, et dans quel ordre.
 *
 * Deux règles partagées par les deux surfaces qui rendent l'histoire d'un
 * spectateur : le journal d'une fiche et le LOG global. Une seconde
 * implémentation de l'une ou de l'autre divergerait en silence, et l'écart
 * ne se verrait que sur des rétro-datages à l'année — c'est-à-dire tard.
 */

/**
 * Types qui n'apparaissent dans aucune surface narrative.
 *
 * `PROG` est le seul. Personne ne veut relire qu'il a poussé une barre à
 * 30 % un mardi soir. Il reste visible là où il sert — la barre de l'accueil
 * — et sauvegardé là où il compte : la section de queue de l'export `.log`,
 * sans laquelle une série à 60 % reviendrait à 0 après restauration.
 *
 * Le store reste append-only : on filtre à l'affichage, jamais à l'écriture.
 */
export const HIDDEN_FROM_HISTORY: ReadonlySet<string> = new Set(['PROG'])

/**
 * Ordre d'affichage : du plus récent au plus ancien.
 *
 * **Les dates inconnues passent en queue.** C'est l'inverse de leur position
 * au rang, où elles passent en tête — et c'est voulu : au rang, « je ne sais
 * plus quand » est nécessairement ancien ; à l'affichage, on ne peut pas le
 * placer, donc on le sort de la chronologie plutôt que de mentir.
 *
 * Départage par `created_at` puis par `id`. Nécessaire et pas théorique : le
 * rétro-datage pose un `START` et un `SEEN` à la même date saisie, et sans
 * départage leur ordre changerait d'un rendu à l'autre.
 */
export function compareEventsDesc(a: StoredEvent, b: StoredEvent): number {
  const byOccurrence = compareNullableDesc(a.occurred_at, b.occurred_at)
  if (byOccurrence !== 0) return byOccurrence

  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** Comparaison décroissante où `null` est rejeté en fin de liste. */
export function compareNullableDesc(a: Timestamp | null, b: Timestamp | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? 1 : a > b ? -1 : 0
}
