import Dexie, { type EntityTable } from 'dexie'

/**
 * Base locale.
 *
 * À l'étape 1, elle ne porte que les réglages. Les tables `events`
 * (source de vérité, append-only), `media_state` (dérivée, reconstructible),
 * `media_cache` et `pending_adds` arrivent à l'étape 2, en version 2 du
 * schéma — Dexie applique les migrations dans l'ordre des versions, donc
 * une base déjà créée en version 1 les recevra sans perdre son contenu.
 */
export interface LigneReglage {
  cle: string
  valeur: string
}

export const db = new Dexie('owlog') as Dexie & {
  settings: EntityTable<LigneReglage, 'cle'>
}

db.version(1).stores({
  settings: '&cle',
})
