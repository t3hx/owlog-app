import { db } from '@/adapters/dexie/db'
import { etatMedia, type LigneEtat } from '@/domain/reducers/etatMedia'
import type { EventId, Evenement, EvenementStocke, MediaRef } from '@/domain/types'
import type { EventStore } from '@/ports/EventStore'

/**
 * Implémentation Dexie du port EventStore.
 *
 * L'adaptateur **stocke, il ne calcule pas**. La ligne `media_state` est
 * produite par `etatMedia`, dans le domaine. Si le calcul vivait ici, la
 * règle de dérivation du statut existerait à deux endroits — et au temps 2,
 * `PostgresEventStore` devrait la réimplémenter.
 */
export function creerEventStore(): EventStore {
  return {
    /**
     * Écrit les événements et rafraîchit les lignes dérivées qu'ils
     * affectent, **dans une seule transaction**.
     *
     * Une écriture partielle laisserait `media_state` désaccordée du
     * journal. Comme la page média et la bibliothèque la lisent toutes les
     * deux, l'app afficherait alors deux statuts différents pour le même
     * titre, sans que rien ne le signale.
     */
    async append(evenements: readonly Evenement[]): Promise<void> {
      if (evenements.length === 0) return

      const refsTouchees = [...new Set(evenements.map((e) => e.media_ref))]

      await db.transaction('rw', db.events, db.media_state, async () => {
        await db.events.bulkAdd([...evenements])

        for (const ref of refsTouchees) {
          await rafraichirEtat(ref)
        }
      })
    },

    async eventsForMedia(ref: MediaRef): Promise<readonly EvenementStocke[]> {
      return db.events.where('media_ref').equals(ref).toArray()
    },

    async allMediaStates(): Promise<readonly LigneEtat[]> {
      return db.media_state.toArray()
    },

    /**
     * Page d'événements après un curseur, par identifiant croissant.
     *
     * Les UUIDv7 étant ordonnables par le temps, parcourir par `id` donne
     * un ordre chronologique stable sans index supplémentaire.
     */
    async eventsSince(
      curseur: EventId | null,
      limite: number,
    ): Promise<readonly EvenementStocke[]> {
      const collection =
        curseur === null ? db.events.orderBy('id') : db.events.where('id').above(curseur)

      return collection.limit(limite).toArray()
    },

    /**
     * Reconstruit intégralement `media_state`.
     *
     * Chemin de réparation, pas utilitaire de confort : depuis que la page
     * média lit la table dérivée, une ligne fausse se voit sur deux écrans.
     * Purge d'abord, ce qui élimine aussi les lignes orphelines qu'un
     * simple recalcul par média laisserait en place.
     */
    async rebuildAllState(): Promise<void> {
      await db.transaction('rw', db.events, db.media_state, async () => {
        await db.media_state.clear()

        const refs = new Set<MediaRef>()
        await db.events.each((evenement) => {
          refs.add(evenement.media_ref)
        })

        for (const ref of refs) {
          await rafraichirEtat(ref)
        }
      })
    },
  }
}

/**
 * Recalcule la ligne dérivée d'un média.
 *
 * À n'appeler que depuis une transaction en écriture sur `events` et
 * `media_state` : la lecture des événements et l'écriture de la ligne
 * doivent voir le même instantané.
 */
async function rafraichirEtat(ref: MediaRef): Promise<void> {
  const evenements = await db.events.where('media_ref').equals(ref).toArray()
  await db.media_state.put(etatMedia(evenements, ref))
}

/** Instance partagée par l'application. */
export const eventStore = creerEventStore()
