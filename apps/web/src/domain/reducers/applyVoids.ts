import type { EventId, EvenementStocke } from '@/domain/types'

/**
 * Retire de la projection les événements annulés.
 *
 * **S'exécute en tête de chaîne** : tous les autres réducteurs consomment
 * sa sortie. Le store lui-même n'est jamais modifié — on ajoute une
 * annulation, on n'efface jamais.
 *
 * Deux règles qui ne se devinent pas :
 *
 * - **Le `VOID` sort aussi de la projection.** Il a fait son travail ; le
 *   laisser passer le ferait apparaître comme une entrée du journal, ce qui
 *   n'a pas de sens à lire.
 * - **Un `VOID` qui vise un autre `VOID` est ignoré.** Annuler une
 *   annulation serait un undo chaîné : le modèle ne le prévoit pas, et le
 *   laisser passer ferait réapparaître un événement que l'utilisateur
 *   croyait supprimé.
 *
 * Un `VOID` peut en revanche cibler un événement d'un **type inconnu** :
 * l'annulation vise un identifiant, pas un type, donc elle fonctionne même
 * sur un événement écrit par une version ultérieure du client.
 */
export function applyVoids(
  evenements: readonly EvenementStocke[],
): readonly EvenementStocke[] {
  const identifiantsDesVoids = new Set<EventId>()
  for (const evenement of evenements) {
    if (evenement.type === 'VOID') {
      identifiantsDesVoids.add(evenement.id)
    }
  }

  const cibles = new Set<EventId>()
  for (const evenement of evenements) {
    if (evenement.type !== 'VOID') continue

    const cible = lireCible(evenement)
    // Un VOID sans cible lisible vient d'une version ultérieure du client :
    // on l'ignore plutôt que de lever, comme n'importe quel type inconnu.
    if (cible === null) continue
    if (identifiantsDesVoids.has(cible)) continue

    cibles.add(cible)
  }

  return evenements.filter(
    (evenement) => evenement.type !== 'VOID' && !cibles.has(evenement.id),
  )
}

function lireCible(evenement: EvenementStocke): EventId | null {
  const payload: unknown = (evenement as { payload?: unknown }).payload
  if (typeof payload !== 'object' || payload === null) return null

  const cible: unknown = (payload as { target?: unknown }).target
  return typeof cible === 'string' ? cible : null
}
