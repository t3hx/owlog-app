import { applyVoids } from './applyVoids.ts'
import { compareEventsDesc, HIDDEN_FROM_HISTORY } from '../rules/history.ts'
import { isKnownEvent, type StoredEvent } from '../types.ts'

/** Une ligne du LOG global. */
export interface LogEntry {
  readonly event: StoredEvent
  /** Faux pour un type écrit par une version ultérieure du client. */
  readonly known: boolean
}

/**
 * LOG global : tout ce qui a été fait, tous médias confondus.
 *
 * **Il ne groupe rien.** C'est ce qui le distingue de `journal(events)`, et
 * c'est la responsabilité unique de chacun. Le marqueur `— visionnage #N —`
 * a du sens sur une fiche, où les cycles d'un même titre se suivent ; noyé
 * dans tous médias confondus, il numéroterait des choses sans rapport les
 * unes sous les autres.
 *
 * Comme partout, `applyVoids` passe en tête de chaîne — donc l'entrée
 * annulée **et** son `VOID` sortent tous les deux du flux. C'est la règle
 * du réducteur d'annulation, pas une décision reprise ici.
 */
export function log(events: readonly StoredEvent[]): readonly LogEntry[] {
  return applyVoids(events)
    .filter((event) => !HIDDEN_FROM_HISTORY.has(event.type))
    .sort(compareEventsDesc)
    .map((event) => ({ event, known: isKnownEvent(event) }))
}
