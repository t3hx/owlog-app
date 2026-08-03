import type { SerializedEvent } from '@owlog/contracts'

/**
 * Traduction des lignes de `events` et `media_cache` vers le contrat.
 *
 * Extraite de `sync/routes.ts` le jour où une seconde surface a eu besoin de
 * relire le journal : la route de profil rejoue les réducteurs du domaine
 * sur ces mêmes lignes. Deux conversions divergeraient sur un détail
 * — `occurred_at` nul, `payload` absent — et la divergence ne se verrait que
 * sur les comptes anciens.
 */
export interface EventRow {
  server_seq: string
  id: string
  device_id: string
  type: string
  media_ref: string
  cycle_key: string | null
  created_at: Date
  occurred_at: Date | null
  occurred_precision: string
  payload: unknown
}

export interface CacheRowRecord {
  ref: string
  payload: unknown
  updated_seq: string
}

/**
 * Une ligne de `events` telle que le client l'a écrite.
 *
 * `payload` absent et `payload: null` ne sont pas la même chose pour les
 * réducteurs : la clé est omise plutôt que posée à `null`, ce qui restitue
 * exactement l'objet poussé.
 */
export function toSerializedEvent(row: EventRow): SerializedEvent {
  return {
    id: row.id,
    device_id: row.device_id,
    type: row.type,
    media_ref: row.media_ref,
    cycle_key: row.cycle_key,
    created_at: row.created_at.toISOString(),
    occurred_at: row.occurred_at === null ? null : row.occurred_at.toISOString(),
    occurred_precision: row.occurred_precision,
    ...(row.payload === null ? {} : { payload: row.payload }),
  }
}
