import { uuidv7 } from 'uuidv7'

import { db } from '@/adapters/dexie/db'
import type { PendingAdd, PendingAdds } from '@/ports/PendingAdds'

/**
 * File d'ajouts hors-ligne, en IndexedDB.
 *
 * Elle survit au rechargement — c'est tout son intérêt : une saisie faite
 * dans le métro doit être encore là le soir. Un état React, ou même
 * `sessionStorage`, la perdrait au premier verrouillage du téléphone.
 */
export function createPendingAdds(now: () => string = () => new Date().toISOString()): PendingAdds {
  return {
    async add(text: string): Promise<void> {
      const trimmed = text.trim()
      if (trimmed.length === 0) return

      await db.pending_adds.add({ id: uuidv7(), text: trimmed, createdAt: now() })
    },

    async all(): Promise<readonly PendingAdd[]> {
      return db.pending_adds.orderBy('createdAt').toArray()
    },

    async remove(id: string): Promise<void> {
      await db.pending_adds.delete(id)
    },
  }
}

export const pendingAdds = createPendingAdds()
