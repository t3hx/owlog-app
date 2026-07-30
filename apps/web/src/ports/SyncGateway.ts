import type { PullResponse, PushRequest, PushResponse } from '@owlog/contracts'

/**
 * Port de la passerelle de synchronisation.
 *
 * C'est la vue client des deux routes `/sync` du serveur, et rien de plus :
 * pas de file, pas de curseur, pas de reprise — tout ça vit dans le moteur.
 * La passerelle transporte et traduit les échecs en valeurs, jamais en
 * exceptions, même promesse que `MediaCatalog`.
 *
 * Chaque échec correspond à une conduite précise du moteur, documentée ici
 * parce que c'est le contrat, pas un détail d'implémentation :
 *
 * - `offline` — réseau coupé : silencieux, on réessaie au prochain
 *   déclencheur ;
 * - `unauthorized` — pas ou plus de session : jamais synchronisé, on se
 *   tait (le compte est optionnel) ; déjà synchronisé, UNE invite de
 *   reconnexion ;
 * - `not-deployed` — 404 : le serveur en face n'a pas encore les routes
 *   `/sync`. Silencieux : « pas encore à jour » n'est pas une panne ;
 * - `payload-too-large` — 413 : le lot se scinde et repart ;
 * - `rate-limited` — 429 : on attend ce que le serveur demande ;
 * - `unavailable` — le reste : 5xx, corps illisible, 503 de base éteinte.
 */
export type SyncFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'not-deployed' }
  | { readonly kind: 'payload-too-large' }
  | { readonly kind: 'rate-limited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' }

export type SyncResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SyncFailure }

/** Curseurs du pull : `server_seq` du journal, `updated_seq` du cache. */
export interface PullCursors {
  readonly after: number
  readonly cacheAfter: number
}

export interface SyncGateway {
  push(request: PushRequest): Promise<SyncResult<PushResponse>>
  pull(cursors: PullCursors): Promise<SyncResult<PullResponse>>
}
