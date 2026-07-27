import Dexie, { type EntityTable } from 'dexie'

import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { StoredEvent } from '@/domain/types'

/**
 * Base locale.
 *
 * Deux natures de table, à ne jamais confondre :
 *
 * - **`events` est la source de vérité.** Append-only : jamais de mise à
 *   jour, jamais de suppression. Une correction est un événement `VOID`.
 * - **`media_state` est dérivée.** Reconstructible intégralement depuis
 *   `events` par `rebuildAllState`. La perdre ne perd aucune donnée
 *   utilisateur.
 *
 * `settings` est à part : ce ne sont pas des événements, ils n'ont pas
 * d'historique et personne ne veut relire dans le journal qu'il a changé
 * son prénom.
 */
export interface SettingRow {
  key: string
  value: string
}

export const db = new Dexie('owlog') as Dexie & {
  settings: EntityTable<SettingRow, 'key'>
  events: EntityTable<StoredEvent, 'id'>
  media_state: EntityTable<MediaStateRow, 'ref'>
}

db.version(1).stores({
  settings: '&key',
})

// Version 2 : le domaine. Dexie applique les migrations dans l'ordre des
// versions, donc une base créée à l'étape 1 reçoit ces tables sans perdre
// le prénom déjà saisi.
db.version(2).stores({
  settings: '&key',
  events: '&id, media_ref, created_at',
  media_state: '&ref, statut',
})
