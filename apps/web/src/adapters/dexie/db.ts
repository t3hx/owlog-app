import Dexie, { type EntityTable } from 'dexie'

import type { MediaStateRow, StoredEvent } from '@owlog/domain'
import type { MediaCacheRow } from '@/ports/MediaCache'
import type { PendingAdd } from '@/ports/PendingAdds'

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

/**
 * Une entrée de la file de synchronisation : un identifiant d'événement à
 * pousser. Rien d'autre — l'événement vit au journal, unique source.
 */
export interface PendingPushRow {
  id: string
}

export const db = new Dexie('owlog') as Dexie & {
  settings: EntityTable<SettingRow, 'key'>
  events: EntityTable<StoredEvent, 'id'>
  media_state: EntityTable<MediaStateRow, 'ref'>
  media_cache: EntityTable<MediaCacheRow, 'ref'>
  pending_adds: EntityTable<PendingAdd, 'id'>
  pending_push: EntityTable<PendingPushRow, 'id'>
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
  media_state: '&ref, status',
})

// Version 3 : le cache TMDB et la file d'ajouts hors-ligne.
//
// `media_cache` n'est pas de la donnée utilisateur, c'est une copie locale
// de ce que TMDB sait d'un titre. `pending_adds` ne contient pas
// d'événements : rien n'entre dans le store avant confirmation.
db.version(3).stores({
  settings: '&key',
  events: '&id, media_ref, created_at',
  media_state: '&ref, status',
  media_cache: '&ref, complete',
  pending_adds: '&id, createdAt',
})

// Version 4 : l'outbox de synchronisation. Des ids d'événements à pousser,
// écrits dans la même transaction que l'append — voir `ports/Outbox.ts`.
db.version(4).stores({
  settings: '&key',
  events: '&id, media_ref, created_at',
  media_state: '&ref, status',
  media_cache: '&ref, complete',
  pending_adds: '&id, createdAt',
  pending_push: '&id',
})
