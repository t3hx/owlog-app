import { applyVoids } from '@/domain/reducers/applyVoids'
import { cycles, type Cycle } from '@/domain/rules/cycles'
import { estConnu, type EtatMedia, type Evenement, type EvenementStocke } from '@/domain/types'

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
export function statutCourant(evenements: readonly EvenementStocke[]): EtatMedia {
  const actifs = applyVoids(evenements)
  const connus = actifs.filter(estConnu)

  if (connus.length === 0) return 'absent'

  if (dernierMouvementEstUnRetrait(connus)) return 'absent'

  const tousLesCycles = cycles(connus)
  if (tousLesCycles.length === 0) return 'a-voir'

  const courant = tousLesCycles[tousLesCycles.length - 1]
  if (!courant) return 'a-voir'

  if (reboucleVersAVoir(connus, courant)) return 'a-voir'

  if (courant.aDrop) return 'abandonne'
  if (courant.aSeen) return 'vu'
  return 'en-cours'
}

/**
 * Le média est-il sorti de la bibliothèque ?
 *
 * Seuls `WATCH` et `REMOVE` répondent à cette question. Un `FAV` postérieur
 * à un `REMOVE` ne doit pas ressusciter le média : c'est pourquoi la
 * comparaison porte sur ces deux types nommément, et non sur « le dernier
 * événement hors cycle ».
 */
function dernierMouvementEstUnRetrait(evenements: readonly Evenement[]): boolean {
  let dernier: Evenement | null = null

  for (const evenement of evenements) {
    if (evenement.type !== 'WATCH' && evenement.type !== 'REMOVE') continue
    if (dernier === null || evenement.created_at >= dernier.created_at) {
      dernier = evenement
    }
  }

  return dernier?.type === 'REMOVE'
}

/**
 * Un `WATCH` hors cycle postérieur à tout le cycle courant ramène à « à voir ».
 *
 * C'est le bouclage de la pastille depuis « abandonné ». La comparaison
 * porte sur `created_at` et non sur `occurred_at` : le geste de taper sur
 * la pastille est un acte d'écriture, il n'a pas de date de survenue propre.
 */
function reboucleVersAVoir(evenements: readonly Evenement[], courant: Cycle): boolean {
  const finDuCycle = courant.evenements.reduce(
    (max, evenement) => (evenement.created_at > max ? evenement.created_at : max),
    '',
  )

  return evenements.some(
    (evenement) => evenement.type === 'WATCH' && evenement.created_at > finDuCycle,
  )
}
