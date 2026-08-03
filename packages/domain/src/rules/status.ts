import { applyVoids } from '../reducers/applyVoids.ts'
import { cycles, type Cycle } from './cycles.ts'
import { isKnownEvent, type MediaStatus, type DomainEvent, type StoredEvent } from '../types.ts'

/**
 * Dérivation du statut d'un média.
 *
 * ```
 *   CE QUE VOIT L'UTILISATEUR                 CE QUE FAIT LE MODÈLE
 *   (tap sur la pastille, linéaire)           (dérivation, par RANG de cycle)
 *
 *         ┌──────────┐                        events du média
 *    ┌───▶│  à voir  │                              │ applyVoids
 *    │    └────┬─────┘                              ▼
 *    │         │ START (nouveau cycle)      cycles groupés par cycle_key
 *    │         ▼                                    │
 *    │    ┌──────────┐                              ▼
 *    │    │ en cours │◀──┐                  triés par RANG
 *    │    └────┬─────┘   │ REWATCH          (occurred_at de l'événement
 *    │         │         │  (nouveau         d'ouverture, puis created_at,
 *    │         │ SEEN    │   cycle)          puis id)
 *    │         ▼         │                          │
 *    │    ┌──────────┐   │                          ▼
 *    │    │    vu    │───┘                  courant = rang le PLUS ÉLEVÉ
 *    │    └────┬─────┘                              │
 *    │         │ DROP                               ▼
 *    │         ▼                            DROP → abandonné · SEEN → vu
 *    │    ┌───────────┐                     sinon → en cours
 *    └────│ abandonné │                             │
 *  WATCH  └───────────┘                   WATCH hors cycle plus récent
 *  (hors cycle)                           (created_at) que tout le cycle
 *                                         courant ? ──▶ à voir
 *
 *   PIÈGE : un SEEN rétro-daté en 2019 sur un titre en cours depuis 2026
 *   porte le created_at le PLUS RÉCENT. Trié par created_at → « vu »
 *   (FAUX). Trié par rang → cycle 2019 = rang 1, cycle 2026 = rang 2 =
 *   courant → reste « en cours » (JUSTE).
 * ```
 *
 * Ce diagramme est recopié du document de design. Le mettre à jour fait
 * partie de toute modification de cette règle : un diagramme périmé induit
 * activement en erreur.
 */
export function currentStatus(events: readonly StoredEvent[]): MediaStatus {
  const active = applyVoids(events)
  const known = active.filter(isKnownEvent)

  if (known.length === 0) return 'absent'

  if (lastLibraryMoveIsRemoval(known)) return 'absent'

  const allCycles = cycles(known)
  if (allCycles.length === 0) return 'to-watch'

  const current = allCycles[allCycles.length - 1]
  if (!current) return 'to-watch'

  if (loopsBackToWatchlist(known, current)) return 'to-watch'

  if (current.hasDrop) return 'dropped'
  if (current.hasSeen) return 'seen'
  return 'watching'
}

/**
 * Le média est-il sorti de la bibliothèque ?
 *
 * Seuls `WATCH` et `REMOVE` répondent à cette question. Un `FAV` postérieur
 * à un `REMOVE` ne doit pas ressusciter le média : c'est pourquoi la
 * comparaison porte sur ces deux types nommément, et non sur « le dernier
 * événement hors cycle ».
 */
function lastLibraryMoveIsRemoval(events: readonly DomainEvent[]): boolean {
  let last: DomainEvent | null = null

  for (const event of events) {
    if (event.type !== 'WATCH' && event.type !== 'REMOVE') continue
    if (last === null || event.created_at >= last.created_at) {
      last = event
    }
  }

  return last?.type === 'REMOVE'
}

/**
 * Un `WATCH` hors cycle postérieur à tout le cycle courant ramène à « à voir ».
 *
 * C'est le bouclage de la pastille depuis « abandonné ». La comparaison
 * porte sur `created_at` et non sur `occurred_at` : le geste de taper sur
 * la pastille est un acte d'écriture, il n'a pas de date de survenue propre.
 */
function loopsBackToWatchlist(events: readonly DomainEvent[], current: Cycle): boolean {
  const cycleEnd = current.events.reduce(
    (max, event) => (event.created_at > max ? event.created_at : max),
    '',
  )

  return events.some(
    (event) => event.type === 'WATCH' && event.created_at > cycleEnd,
  )
}
