import {
  pushRequestSchema,
  SYNC_BATCH_LIMIT,
  SYNC_BODY_LIMIT_BYTES,
  type ApiError,
  type PulledCacheRow,
  type PulledEvent,
  type PullResponse,
  type PushResponse,
} from '@owlog/contracts'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Pool } from 'pg'

import { sessionUser } from '../auth/routes.ts'
import { toSerializedEvent, type CacheRowRecord, type EventRow } from '../db/eventRows.ts'

/**
 * Réplication : push/pull du journal d'événements et du cache média.
 *
 * Le serveur est un entrepôt de faits, pas un interprète : il stocke des
 * événements qu'il ne lit pas et des lignes de cache opaques, et rend le
 * tout dans l'ordre d'un curseur. Toute la sémantique (statuts, cycles,
 * projections) reste dans le domaine, côté client.
 *
 * Règles non négociables, chacune couverte par un test de route :
 *
 * - **La visibilité des `server_seq` est sérialisée par utilisateur.**
 *   `BIGSERIAL` attribue les numéros à l'insertion, mais la visibilité
 *   suit l'ordre des commits : deux transactions commitées dans le
 *   désordre laisseraient un pull voir seq N+1 sans seq N — et le curseur
 *   du client sauterait seq N pour TOUJOURS, en silence. La transaction
 *   du push prend `pg_advisory_xact_lock(hashtext(user_id))` : un seul
 *   utilisateur attend, le trou devient impossible.
 * - **Le push est idempotent** par `ON CONFLICT (user_id, id) DO NOTHING`,
 *   et les doublons sont ACQUITTÉS : un ack perdu ne doit pas laisser
 *   l'outbox du client pousser le même événement à l'infini.
 * - **Un curseur inconnu resynchronise depuis 0.** Un curseur au-delà du
 *   max connu ne peut venir que d'un état client corrompu ; le taire
 *   bloquerait la sync en silence, alors que `restore()` est idempotent.
 * - **`user_id` dérive de la session, jamais d'un corps de requête.**
 */
export interface SyncDeps {
  /** Paresseux : la garde `db` de l'app a déjà statué quand on déréférence. */
  readonly pool: () => Pool
}

interface SyncEnv {
  readonly Variables: { userId: string }
}

export function createSyncRoutes(deps: SyncDeps) {
  const sync = new Hono<SyncEnv>()

  // Avant toute lecture du corps : un lot obèse est refusé net, le client
  // scinde et réessaie. La limite vit dans le contrat, pas ici.
  sync.use(
    '*',
    bodyLimit({
      maxSize: SYNC_BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'payload-too-large' } satisfies ApiError, 413),
    }),
  )

  sync.use('*', async (c, next) => {
    const user = await sessionUser(deps.pool(), c)
    if (!user) return fail(c, 401, 'unauthorized')
    c.set('userId', user.id)
    await next()
  })

  sync.post('/events', async (c) => {
    const userId = c.get('userId')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return fail(c, 400, 'bad-request')
    }

    const parsed = pushRequestSchema.safeParse(body)
    if (!parsed.success) return fail(c, 400, 'bad-request')
    const { events, cacheRows = [] } = parsed.data

    const client = await deps.pool().connect()
    try {
      await client.query('BEGIN')
      // Le verrou transactionnel se libère au COMMIT comme au ROLLBACK :
      // aucun chemin d'erreur ne peut le laisser tenu.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [userId])

      for (const event of events) {
        await client.query(
          `INSERT INTO events (user_id, id, device_id, type, media_ref, cycle_key,
                               created_at, occurred_at, occurred_precision, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (user_id, id) DO NOTHING`,
          [
            userId,
            event.id,
            event.device_id,
            event.type,
            event.media_ref,
            event.cycle_key,
            event.created_at,
            event.occurred_at,
            event.occurred_precision,
            // Stringifié explicitement : node-pg sérialise les tableaux JS
            // en tableaux Postgres, pas en JSON — un payload tableau
            // casserait sans ça.
            event.payload === undefined ? null : JSON.stringify(event.payload),
          ],
        )
      }

      for (const row of cacheRows) {
        // Dernière version gagne : c'est un cache, pas une source de
        // vérité. Le bump d'`updated_seq` est ce qui fait voir la mise à
        // jour aux pulls incrémentaux des autres appareils.
        await client.query(
          `INSERT INTO media_cache (user_id, ref, payload)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, ref) DO UPDATE
             SET payload = EXCLUDED.payload,
                 updated_seq = nextval('media_cache_seq')`,
          [userId, row.ref, JSON.stringify(row.payload)],
        )
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    // Tout id du lot est présent en base à ce point — inséré ou déjà
    // connu. Les deux s'acquittent : voir l'en-tête du fichier.
    const accepted = [...new Set(events.map((event) => event.id))]
    return c.json({ accepted } satisfies PushResponse)
  })

  sync.get('/events', async (c) => {
    const pool = deps.pool()
    const userId = c.get('userId')

    const after = await resolveEventCursor(pool, userId, c.req.query('after'))
    const cacheAfter = await resolveCacheCursor(pool, userId, c.req.query('cacheAfter'))

    const events = await pool.query<EventRow>(
      `SELECT server_seq, id, device_id, type, media_ref, cycle_key,
              created_at, occurred_at, occurred_precision, payload
       FROM events
       WHERE user_id = $1 AND server_seq > $2
       ORDER BY server_seq
       LIMIT ${SYNC_BATCH_LIMIT}`,
      [userId, after],
    )

    const cache = await pool.query<CacheRowRecord>(
      `SELECT ref, payload, updated_seq
       FROM media_cache
       WHERE user_id = $1 AND updated_seq > $2
       ORDER BY updated_seq
       LIMIT ${SYNC_BATCH_LIMIT}`,
      [userId, cacheAfter],
    )

    const response: PullResponse = {
      events: events.rows.map(pulledEvent),
      cacheRows: cache.rows.map(pulledCacheRow),
      hasMore:
        events.rows.length === SYNC_BATCH_LIMIT || cache.rows.length === SYNC_BATCH_LIMIT,
    }
    return c.json(response)
  })

  return sync
}

function pulledEvent(row: EventRow): PulledEvent {
  // `server_seq` est un bigint, que node-pg rend en chaîne. Number() est
  // sûr jusqu'à 2^53 événements — pas une borne atteignable.
  return { serverSeq: Number(row.server_seq), event: toSerializedEvent(row) }
}

function pulledCacheRow(row: CacheRowRecord): PulledCacheRow {
  return { updatedSeq: Number(row.updated_seq), ref: row.ref, payload: row.payload }
}

/**
 * Résout le curseur envoyé par le client : illisible OU au-delà du max
 * connu de l'utilisateur → 0, resync complet. Voir l'en-tête du fichier.
 */
async function resolveEventCursor(
  pool: Pool,
  userId: string,
  raw: string | undefined,
): Promise<number> {
  const cursor = parseCursor(raw)
  if (cursor === 0) return 0
  const known = await pool.query<{ max: string }>(
    `SELECT COALESCE(max(server_seq), 0) AS max FROM events WHERE user_id = $1`,
    [userId],
  )
  return cursor > Number(known.rows[0]!.max) ? 0 : cursor
}

async function resolveCacheCursor(
  pool: Pool,
  userId: string,
  raw: string | undefined,
): Promise<number> {
  const cursor = parseCursor(raw)
  if (cursor === 0) return 0
  const known = await pool.query<{ max: string }>(
    `SELECT COALESCE(max(updated_seq), 0) AS max FROM media_cache WHERE user_id = $1`,
    [userId],
  )
  return cursor > Number(known.rows[0]!.max) ? 0 : cursor
}

/** Entier positif en base 10, rien d'autre. Tout le reste vaut 0. */
function parseCursor(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,15}$/.test(raw)) return 0
  return Number(raw)
}

function fail(c: Context, status: 400 | 401, error: ApiError['error']) {
  return c.json({ error } satisfies ApiError, status)
}
