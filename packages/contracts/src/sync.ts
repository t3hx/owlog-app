import { z } from 'zod'

/**
 * Contrat de réplication entre `owlog-web` et `owlog-api`.
 *
 * Une validation, deux consommateurs : le serveur valide les corps de push
 * avec ces schémas, le client construit ses lots avec les mêmes formes et
 * les mêmes bornes. Une divergence de cap entre les deux ferait rejeter en
 * production des lots que le client croit légitimes.
 *
 * Le serveur STOCKE des faits, il ne les interprète pas : la validation est
 * structurelle et bornée, jamais sémantique. `type` et `occurred_precision`
 * sont des textes libres bornés — un serveur qui refuserait un type
 * d'événement qu'il ne connaît pas casserait l'appareil le plus à jour.
 */

/** Taille maximale d'un lot, au push comme au pull. */
export const SYNC_BATCH_LIMIT = 500

/**
 * Cap de sérialisation JSON d'un événement.
 *
 * Très au-dessus du nominal (~300 octets), très en dessous de
 * `SYNC_BODY_LIMIT_BYTES` : un événement isolé passe donc toujours, et la
 * scission d'un lot refusé en 413 converge — elle ne peut pas buter sur un
 * élément indivisible trop gros.
 */
export const SYNC_EVENT_MAX_BYTES = 4_096

/** Cap de sérialisation JSON d'une ligne de cache média. */
export const SYNC_CACHE_ROW_MAX_BYTES = 16_384

/**
 * Limite du corps d'une requête `/sync`, appliquée par `bodyLimit` côté
 * Hono avant toute lecture : pas de POST de plusieurs Mo à travers le
 * tunnel. Le client qui la heurte reçoit 413 et scinde son lot.
 */
export const SYNC_BODY_LIMIT_BYTES = 1_048_576

/** `Date#toISOString()` produit `Z` ; l'offset explicite est toléré. */
const isoTimestamp = z.iso.datetime({ offset: true })

const jsonBytes = (value: unknown) => JSON.stringify(value).length

/**
 * Un événement tel qu'il voyage — la forme de `StoredEvent` côté client.
 *
 * `strictObject` : un champ inconnu est refusé plutôt que silencieusement
 * perdu. Un client plus récent qui enverrait une colonne nouvelle échoue
 * bruyamment (et son outbox réessaiera après mise à jour du serveur) au
 * lieu de répliquer des événements amputés. L'évolution nominale passe par
 * `payload`, pas par de nouvelles colonnes.
 */
export const serializedEventSchema = z
  .strictObject({
    id: z.uuid(),
    device_id: z.string().min(1).max(128),
    type: z.string().min(1).max(64),
    media_ref: z.string().min(1).max(256),
    cycle_key: z.string().min(1).max(256).nullable(),
    created_at: isoTimestamp,
    occurred_at: isoTimestamp.nullable(),
    occurred_precision: z.string().min(1).max(32),
    payload: z.unknown().optional(),
  })
  .refine((event) => jsonBytes(event) <= SYNC_EVENT_MAX_BYTES, {
    message: 'event exceeds size cap',
  })

export type SerializedEvent = z.infer<typeof serializedEventSchema>

/**
 * Une ligne de cache média telle qu'elle voyage. Le serveur n'en lit aucun
 * champ — `payload` est opaque, seulement borné.
 */
export const syncCacheRowSchema = z
  .strictObject({
    ref: z.string().min(1).max(256),
    payload: z.unknown(),
  })
  .refine((row) => row.payload !== undefined, { message: 'payload is required' })
  .refine((row) => jsonBytes(row) <= SYNC_CACHE_ROW_MAX_BYTES, {
    message: 'cache row exceeds size cap',
  })

export type SyncCacheRow = z.infer<typeof syncCacheRowSchema>

/**
 * Corps de `POST /sync/events`. Les `cacheRows` sont optionnelles : un
 * push d'événements seuls et une mise à jour de cache sans événement sont
 * tous deux légitimes.
 */
export const pushRequestSchema = z.strictObject({
  events: z.array(serializedEventSchema).max(SYNC_BATCH_LIMIT),
  cacheRows: z.array(syncCacheRowSchema).max(SYNC_BATCH_LIMIT).optional(),
})

export type PushRequest = z.infer<typeof pushRequestSchema>

/**
 * Réponse du push : les ids présents en base à l'issue de la transaction —
 * insérés à l'instant OU déjà connus. L'ack des doublons est vital : sans
 * lui, l'outbox du client ne se viderait jamais d'un événement déjà
 * transmis dont l'ack s'est perdu en route.
 */
export interface PushResponse {
  readonly accepted: readonly string[]
}

/**
 * Un événement tiré, avec son curseur. `serverSeq` reste hors de l'objet
 * événement : c'est une donnée de réplication, elle ne doit jamais entrer
 * dans le store local ni dans un export `.log`.
 */
export interface PulledEvent {
  readonly serverSeq: number
  readonly event: SerializedEvent
}

/** Une ligne de cache tirée, avec son curseur propre. */
export interface PulledCacheRow {
  readonly updatedSeq: number
  readonly ref: string
  readonly payload: unknown
}

/**
 * Réponse de `GET /sync/events?after=&cacheAfter=`.
 *
 * Deux curseurs indépendants — `server_seq` pour le journal, `updated_seq`
 * pour le cache : une mise à jour de cache sans événement se propage aussi.
 * `hasMore` invite à rappeler immédiatement avec les curseurs avancés.
 */
export interface PullResponse {
  readonly events: readonly PulledEvent[]
  readonly cacheRows: readonly PulledCacheRow[]
  readonly hasMore: boolean
}
