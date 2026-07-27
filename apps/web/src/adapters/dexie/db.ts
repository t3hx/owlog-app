import Dexie, { type EntityTable } from 'dexie'

import type { LigneEtat } from '@/domain/reducers/etatMedia'
import type { EvenementStocke } from '@/domain/types'

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
export interface LigneReglage {
  cle: string
  valeur: string
}

export const db = new Dexie('owlog') as Dexie & {
  settings: EntityTable<LigneReglage, 'cle'>
  events: EntityTable<EvenementStocke, 'id'>
  media_state: EntityTable<LigneEtat, 'ref'>
}

db.version(1).stores({
  settings: '&cle',
})

// Version 2 : le domaine. Dexie applique les migrations dans l'ordre des
// versions, donc une base créée à l'étape 1 reçoit ces tables sans perdre
// le prénom déjà saisi.
db.version(2).stores({
  settings: '&cle',
  events: '&id, media_ref, created_at',
  media_state: '&ref, statut',
})
