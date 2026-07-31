import { liveQuery } from 'dexie'

import { db } from '@/adapters/dexie/db'
import type { EventId, StoredEvent } from '@owlog/domain'
import type { Outbox } from '@/ports/Outbox'

/**
 * Implémentation Dexie du port Outbox.
 *
 * La table `pending_push` est **remplie par l'adaptateur EventStore**, dans
 * les transactions d'`append` et de `restore` — c'est la propriété
 * fondatrice de la file, elle ne peut pas vivre ici. Cet adaptateur ne
 * fait que la consommer : lire le prochain lot, acquitter, recharger.
 */
export function createOutbox(): Outbox {
  return {
    /**
     * Le lot suivant, joint depuis le journal. Un id orphelin — événement
     * disparu, ce que rien ne devrait produire — est ignoré plutôt que de
     * bloquer la file pour toujours.
     */
    async nextBatch(limit: number): Promise<readonly StoredEvent[]> {
      const ids = await db.pending_push.orderBy('id').limit(limit).primaryKeys()
      if (ids.length === 0) return []

      const events = await db.events.where('id').anyOf(ids).toArray()
      return events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    },

    async acknowledge(ids: readonly EventId[]): Promise<void> {
      if (ids.length === 0) return
      await db.pending_push.bulkDelete([...ids])
    },

    count(): Promise<number> {
      return db.pending_push.count()
    },

    /**
     * Tout le journal en file, y compris l'historique `device_id: 'local'`
     * du temps 1 qui n'est jamais passé par l'outbox. `bulkPut` : les ids
     * déjà en attente le restent, sans erreur.
     */
    async enqueueAll(): Promise<number> {
      return db.transaction('rw', db.events, db.pending_push, async () => {
        const ids = await db.events.toCollection().primaryKeys()
        await db.pending_push.bulkPut(ids.map((id) => ({ id })))
        return ids.length
      })
    },

    /**
     * `liveQuery` hors React : Dexie ré-émet le compte après chaque
     * transaction qui touche la table. C'est le déclencheur unique du
     * push — tout ce qui remplit la file le fait sonner.
     */
    observeCount(callback: (count: number) => void): () => void {
      const subscription = liveQuery(() => db.pending_push.count()).subscribe({
        next: callback,
        // Une erreur d'observation ne doit pas tuer le moteur : la file
        // sera relue au prochain déclencheur.
        error: () => undefined,
      })
      return () => subscription.unsubscribe()
    },
  }
}

/** Instance partagée par l'application. */
export const outbox = createOutbox()
