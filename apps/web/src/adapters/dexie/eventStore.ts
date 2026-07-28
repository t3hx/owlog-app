import { db } from '@/adapters/dexie/db'
import { mediaState, type MediaStateRow } from '@/domain/reducers/mediaState'
import type { EventId, DomainEvent, StoredEvent, MediaRef } from '@/domain/types'
import type { MediaCacheRow } from '@/ports/MediaCache'
import type { EventStore, RestoreReport } from '@/ports/EventStore'

/**
 * Implémentation Dexie du port EventStore.
 *
 * L'adaptateur **stocke, il ne calcule pas**. La ligne `media_state` est
 * produite par `mediaState`, dans le domaine. Si le calcul vivait ici, la
 * règle de dérivation du statut existerait à deux endroits — et au temps 2,
 * `PostgresEventStore` devrait la réimplémenter.
 */
export function createEventStore(): EventStore {
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
    async append(
      events: readonly DomainEvent[],
      options?: { readonly cacheRows?: readonly MediaCacheRow[] },
    ): Promise<void> {
      if (events.length === 0) return

      const touchedRefs = [...new Set(events.map((e) => e.media_ref))]
      const cacheRows = options?.cacheRows ?? []

      await db.transaction(
        'rw',
        db.events,
        db.media_state,
        db.media_cache,
        async () => {
          await db.events.bulkAdd([...events])

          // Les lignes de cache entrent dans LA MEME transaction. Sans ca,
          // couper le reseau juste apres un ajout laisserait une
          // bibliotheque de references nues, sans titre ni affiche.
          if (cacheRows.length > 0) {
            await db.media_cache.bulkPut([...cacheRows])
          }

          for (const ref of touchedRefs) {
            await refreshMediaState(ref)
          }
        },
      )
    },

    async mediaCache(refs: readonly MediaRef[]): Promise<readonly MediaCacheRow[]> {
      if (refs.length === 0) return []
      return db.media_cache.where('ref').anyOf([...refs]).toArray()
    },

    async upsertMediaCache(rows: readonly MediaCacheRow[]): Promise<void> {
      if (rows.length === 0) return
      await db.media_cache.bulkPut([...rows])
    },

    async eventsForMedia(ref: MediaRef): Promise<readonly StoredEvent[]> {
      return db.events.where('media_ref').equals(ref).toArray()
    },

    async allMediaStates(): Promise<readonly MediaStateRow[]> {
      return db.media_state.toArray()
    },

    /**
     * Page d'événements après un curseur, par identifiant croissant.
     *
     * Les UUIDv7 étant ordonnables par le temps, parcourir par `id` donne
     * un ordre chronologique stable sans index supplémentaire.
     */
    async eventsSince(
      cursor: EventId | null,
      limit: number,
    ): Promise<readonly StoredEvent[]> {
      const collection =
        cursor === null ? db.events.orderBy('id') : db.events.where('id').above(cursor)

      return collection.limit(limit).toArray()
    },

    /**
     * Réinjecte une sauvegarde, sans jamais lever sur un doublon.
     *
     * Le tri des connus et des inconnus se fait **dans la transaction** : le
     * lire avant l'ouvrir laisserait une fenêtre où un ajout concurrent
     * rendrait le compte faux, et le rapport affiché mentirait.
     */
    async restore(
      events: readonly StoredEvent[],
      cacheRows: readonly MediaCacheRow[],
    ): Promise<RestoreReport> {
      return db.transaction(
        'rw',
        db.events,
        db.media_state,
        db.media_cache,
        async () => {
          const existing = new Set(
            await db.events
              .where('id')
              .anyOf(events.map((event) => event.id))
              .primaryKeys(),
          )

          const fresh = events.filter((event) => !existing.has(event.id))
          if (fresh.length > 0) await db.events.bulkAdd(fresh)

          for (const row of cacheRows) {
            // Une ligne complete vaut mieux que le titre nu du fichier.
            const known = await db.media_cache.get(row.ref)
            if (!known?.complete) await db.media_cache.put(row)
          }

          for (const ref of new Set(fresh.map((event) => event.media_ref))) {
            await refreshMediaState(ref)
          }

          return { added: fresh.length, skipped: events.length - fresh.length }
        },
      )
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
        await db.events.each((event) => {
          refs.add(event.media_ref)
        })

        for (const ref of refs) {
          await refreshMediaState(ref)
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
async function refreshMediaState(ref: MediaRef): Promise<void> {
  const events = await db.events.where('media_ref').equals(ref).toArray()
  await db.media_state.put(mediaState(events, ref))
}

/** Instance partagée par l'application. */
export const eventStore = createEventStore()
