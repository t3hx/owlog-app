import { db } from '@/adapters/dexie/db'
import type { LocalData } from '@/ports/LocalData'

/**
 * Implémentation Dexie du port LocalData.
 *
 * Une transaction sur TOUTES les tables : la purge est atomique. Vider
 * table par table hors transaction pourrait être interrompu (onglet fermé
 * mi-course) et laisser un état qu'aucun chemin de code n'a jamais produit
 * autrement — un journal sans réglages, des projections sans journal.
 */
export function createLocalData(): LocalData {
  return {
    async purgeAll(): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        await Promise.all(db.tables.map((table) => table.clear()))
      })
    },
  }
}

/** Instance partagée par l'application. */
export const localData = createLocalData()
