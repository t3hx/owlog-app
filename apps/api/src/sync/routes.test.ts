import {
  SHARED_TOKEN_HEADER,
  SYNC_BATCH_LIMIT,
  SYNC_EVENT_MAX_BYTES,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SerializedEvent,
} from '@owlog/contracts'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { createDb, type Db } from '../db/db.ts'
import { MIGRATIONS_DIR } from '../db/migrate.ts'
import type { MailMessage, Mailer } from '../mail/mailer.ts'
import type { TmdbClient } from '../tmdb.ts'

/**
 * Les routes de réplication, contre une vraie base.
 *
 * Le TDD de F4 vit ici : un push idempotent dont la visibilité des
 * `server_seq` est sérialisée par utilisateur (advisory lock), un pull
 * paginé dont un curseur inconnu déclenche un resync inoffensif, et la
 * réplication du cache média sur son propre curseur.
 *
 * Le test « transactions entrelacées » est LE test du sprint : il prouve
 * qu'un pull passé entre deux commits dans le désordre ne peut pas créer
 * de trou de curseur permanent.
 */
const adminUrl = inject('databaseAdminUrl')

const CONFIG: Config = {
  port: 0,
  tmdbToken: 'tmdb-test-token',
  sharedToken: 'shared-test-token',
  allowedOrigins: [],
  trustedProxies: ['10.0.0.1'],
  basePath: '',
  databaseUrl: undefined,
  publicOrigin: 'https://owlog.test',
  email: undefined,
  oauth: {},
}

const IP = '203.0.113.7'

function fakeTmdb(): TmdbClient {
  return {
    search: async () => ({ hits: [], count: 0 }),
    detail: async () => {
      throw new Error('not used here')
    },
    season: async () => {
      throw new Error('not used here')
    },
  }
}

interface CaptureMailer extends Mailer {
  readonly sent: MailMessage[]
}

function captureMailer(): CaptureMailer {
  const sent: MailMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
  }
}

let scratch: ScratchDb
let db: Db

beforeEach(async () => {
  if (!adminUrl) return
  scratch = await createScratchDb(adminUrl)
  db = createDb({ url: scratch.url, migrationsDir: MIGRATIONS_DIR, retryDelayMs: null })
  await db.start()
})

afterEach(async () => {
  if (!adminUrl) return
  await db.stop()
  await scratch.drop()
})

function makeApp(mailer: Mailer = captureMailer()) {
  return createApp({ config: CONFIG, tmdb: fakeTmdb(), db, mailer })
}

type App = ReturnType<typeof makeApp>

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [SHARED_TOKEN_HEADER]: CONFIG.sharedToken,
    'content-type': 'application/json',
    'cf-connecting-ip': IP,
    ...extra,
  }
}

/**
 * Ouvre une session par le parcours nominal (code court) et rend la paire
 * `nom=valeur` du cookie : les routes `/sync` dérivent l'identité de la
 * session, les tests aussi.
 */
async function login(email = 'sync@test.dev'): Promise<{ app: App; cookie: string }> {
  const mailer = captureMailer()
  const app = makeApp(mailer)

  const requested = await app.fetch(
    new Request('http://local/auth/request-link', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, language: 'fr' }),
    }),
  )
  expect(requested.status).toBe(200)

  const mail = mailer.sent.at(-1)
  if (!mail) throw new Error('no mail captured')
  const code = /\b(\d{6})\b/.exec(mail.subject)?.[1]
  if (!code) throw new Error(`code not found in: ${mail.subject}`)

  const verified = await app.fetch(
    new Request('http://local/auth/verify-code', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, code }),
    }),
  )
  expect(verified.status).toBe(200)

  const pair = verified.headers.get('set-cookie')?.split(';')[0]
  if (!pair?.startsWith('owlog_session=')) throw new Error('no session cookie')
  return { app, cookie: pair }
}

let eventCounter = 0

/** Un événement sérialisé valide, unique par appel. */
function makeEvent(overrides: Partial<SerializedEvent> = {}): SerializedEvent {
  eventCounter += 1
  const suffix = String(eventCounter).padStart(12, '0')
  return {
    id: `01920000-0000-7000-8000-${suffix}`,
    device_id: 'device-a',
    type: 'WATCH',
    media_ref: 'tmdb:movie/603',
    cycle_key: null,
    created_at: '2026-07-30T12:00:00.000Z',
    occurred_at: null,
    occurred_precision: 'unknown',
    ...overrides,
  }
}

async function push(app: App, cookie: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request('http://local/sync/events', {
      method: 'POST',
      headers: headers({ cookie }),
      body: JSON.stringify(body),
    }),
  )
}

async function pushOk(app: App, cookie: string, body: PushRequest): Promise<PushResponse> {
  const response = await push(app, cookie, body)
  expect(response.status).toBe(200)
  return (await response.json()) as PushResponse
}

async function pull(
  app: App,
  cookie: string,
  query: { after?: string; cacheAfter?: string } = {},
): Promise<Response> {
  const params = new URLSearchParams()
  if (query.after !== undefined) params.set('after', query.after)
  if (query.cacheAfter !== undefined) params.set('cacheAfter', query.cacheAfter)
  const suffix = params.size > 0 ? `?${params}` : ''
  return app.fetch(
    new Request(`http://local/sync/events${suffix}`, { headers: headers({ cookie }) }),
  )
}

async function pullOk(
  app: App,
  cookie: string,
  query: { after?: string; cacheAfter?: string } = {},
): Promise<PullResponse> {
  const response = await pull(app, cookie, query)
  expect(response.status).toBe(200)
  return (await response.json()) as PullResponse
}

describe.skipIf(!adminUrl)('garde des routes /sync', () => {
  it('refuse le push sans jeton partagé', async () => {
    const { app, cookie } = await login()
    const response = await app.fetch(
      new Request('http://local/sync/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ events: [makeEvent()] }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('refuse le push sans session', async () => {
    const app = makeApp()
    const response = await push(app, '', { events: [makeEvent()] })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('refuse le pull sans session', async () => {
    const app = makeApp()
    const response = await pull(app, '')
    expect(response.status).toBe(401)
  })

  it('refuse un corps qui n’est pas du JSON', async () => {
    const { app, cookie } = await login()
    const response = await app.fetch(
      new Request('http://local/sync/events', {
        method: 'POST',
        headers: headers({ cookie }),
        body: 'not json',
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'bad-request' })
  })

  it('refuse un corps sans liste d’événements', async () => {
    const { app, cookie } = await login()
    const response = await push(app, cookie, { cacheRows: [] })
    expect(response.status).toBe(400)
  })

  it('refuse un événement mal formé', async () => {
    const { app, cookie } = await login()
    const broken = { ...makeEvent(), id: 'not-a-uuid' }
    const response = await push(app, cookie, { events: [broken] })
    expect(response.status).toBe(400)
  })

  it(`refuse un lot de plus de ${SYNC_BATCH_LIMIT} événements`, async () => {
    const { app, cookie } = await login()
    const events = Array.from({ length: SYNC_BATCH_LIMIT + 1 }, () => makeEvent())
    const response = await push(app, cookie, { events })
    expect(response.status).toBe(400)
  })

  it('refuse un événement au-delà du cap de taille', async () => {
    const { app, cookie } = await login()
    const oversized = makeEvent({
      type: 'NOTE',
      cycle_key: 'c1',
      payload: { text: 'x'.repeat(SYNC_EVENT_MAX_BYTES) },
    })
    const response = await push(app, cookie, { events: [oversized] })
    expect(response.status).toBe(400)
  })

  it('refuse un corps au-delà de la limite globale — 413', async () => {
    const { app, cookie } = await login()
    // Chaque événement passe le cap unitaire ; c'est le total qui déborde.
    const events = Array.from({ length: 400 }, () =>
      makeEvent({ type: 'NOTE', cycle_key: 'c1', payload: { text: 'x'.repeat(3_000) } }),
    )
    const response = await push(app, cookie, { events })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload-too-large' })
  })

  it('limite le débit — 429 avec Retry-After', async () => {
    const { app, cookie } = await login()
    for (let i = 0; i < 120; i += 1) {
      const response = await pull(app, cookie)
      expect(response.status).toBe(200)
    }

    const limited = await pull(app, cookie)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(await limited.json()).toMatchObject({ error: 'rate-limited' })
  })
})

describe.skipIf(!adminUrl)('push idempotent', () => {
  it('accepte un lot et le rend au pull, dans l’ordre, avec des seq contigus', async () => {
    const { app, cookie } = await login()
    const first = makeEvent({
      type: 'SEEN',
      cycle_key: 'cycle-1',
      occurred_at: '2026-07-29T21:30:00.000Z',
      occurred_precision: 'exact',
      payload: { source: 'test' },
    })
    const second = makeEvent({ type: 'FAV' })

    const accepted = await pushOk(app, cookie, { events: [first, second] })
    expect([...accepted.accepted].sort()).toEqual([first.id, second.id].sort())

    const pulled = await pullOk(app, cookie)
    expect(pulled.hasMore).toBe(false)
    expect(pulled.events.map((e) => e.serverSeq)).toEqual([1, 2])
    // Round-trip intégral : ce qui est poussé ressort à l'identique.
    expect(pulled.events[0]!.event).toEqual(first)
    expect(pulled.events[1]!.event).toEqual(second)
  })

  it('rejoue le même lot sans doubler — les ids déjà connus restent acceptés', async () => {
    const { app, cookie } = await login()
    const event = makeEvent()

    const first = await pushOk(app, cookie, { events: [event] })
    const again = await pushOk(app, cookie, { events: [event] })

    // L'ack du doublon est vital : sans lui, l'outbox du client ne se vide
    // jamais pour un événement déjà transmis dont l'ack s'est perdu.
    expect(first.accepted).toEqual([event.id])
    expect(again.accepted).toEqual([event.id])

    const pulled = await pullOk(app, cookie)
    expect(pulled.events).toHaveLength(1)
  })

  it('accepte un type d’événement inconnu — borné mais jamais refusé', async () => {
    const { app, cookie } = await login()
    const future = makeEvent({
      type: 'IMPORT_CSV',
      cycle_key: 'cycle-x',
      payload: { rows: 12 },
    })

    const accepted = await pushOk(app, cookie, { events: [future] })
    expect(accepted.accepted).toEqual([future.id])

    const pulled = await pullOk(app, cookie)
    expect(pulled.events[0]!.event).toEqual(future)
  })

  it('n’écrit jamais l’identité du corps de requête — la session fait foi', async () => {
    const { app, cookie } = await login('a@test.dev')
    const other = await login('b@test.dev')

    await pushOk(app, cookie, { events: [makeEvent()] })

    const foreign = await pullOk(other.app, other.cookie)
    expect(foreign.events).toEqual([])
    expect(foreign.cacheRows).toEqual([])
  })

  it('sérialise la visibilité des seq par utilisateur — pas de trou de curseur', async () => {
    // LE test « vendredi 2 h du matin ». Scénario sans verrou : tx1 prend
    // seq 1, tx2 prend seq 2, tx2 committe la première, un pull passe —
    // il voit seq 2, le curseur avance, et seq 1 devient invisible pour
    // toujours. Avec pg_advisory_xact_lock(hashtext(user_id)), tx2 attend
    // le commit de tx1 : aucun pull ne peut voir un seq sans ses
    // prédécesseurs.
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [makeEvent()] }) // seq 1, hors scène

    const { rows } = await db.pool.query<{ id: string }>(`SELECT id FROM users`)
    const userId = rows[0]!.id

    // tx1 : un push mi-vol, verrou pris, insertion faite, commit retenu.
    const tx1 = new Client({ connectionString: scratch.url })
    await tx1.connect()
    await tx1.query('BEGIN')
    await tx1.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [userId])
    const held = makeEvent({ type: 'SEEN', cycle_key: 'held' })
    await tx1.query(
      `INSERT INTO events (user_id, id, device_id, type, media_ref, cycle_key,
                           created_at, occurred_at, occurred_precision, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        held.id,
        held.device_id,
        held.type,
        held.media_ref,
        held.cycle_key,
        held.created_at,
        held.occurred_at,
        held.occurred_precision,
        null,
      ],
    )

    try {
      // tx2 : un push par la route, qui doit bloquer sur le verrou.
      const racing = makeEvent({ type: 'FAV' })
      let racingDone = false
      const racingPush = pushOk(app, cookie, { events: [racing] }).then((r) => {
        racingDone = true
        return r
      })

      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(racingDone).toBe(false)

      // Le pull entre les deux commits : il ne doit voir NI l'insertion
      // non commitée NI celle qui attend le verrou — donc aucun trou.
      const between = await pullOk(app, cookie, { after: '1' })
      expect(between.events).toEqual([])

      await tx1.query('COMMIT')
      await racingPush

      const after = await pullOk(app, cookie, { after: '1' })
      expect(after.events.map((e) => e.serverSeq)).toEqual([2, 3])
      expect(after.events.map((e) => e.event.id)).toEqual([held.id, racing.id])
    } finally {
      await tx1.end()
    }
  })
})

describe.skipIf(!adminUrl)('pull paginé', () => {
  it(`pagine par ${SYNC_BATCH_LIMIT} et annonce la suite`, async () => {
    const { app, cookie } = await login()
    const batchA = Array.from({ length: SYNC_BATCH_LIMIT }, () => makeEvent())
    const extra = makeEvent()
    await pushOk(app, cookie, { events: batchA })
    await pushOk(app, cookie, { events: [extra] })

    const firstPage = await pullOk(app, cookie)
    expect(firstPage.events).toHaveLength(SYNC_BATCH_LIMIT)
    expect(firstPage.hasMore).toBe(true)

    const lastSeq = firstPage.events.at(-1)!.serverSeq
    const secondPage = await pullOk(app, cookie, { after: String(lastSeq) })
    expect(secondPage.events).toHaveLength(1)
    expect(secondPage.events[0]!.event.id).toBe(extra.id)
    expect(secondPage.hasMore).toBe(false)
  })

  it('reprend exactement après le curseur', async () => {
    const { app, cookie } = await login()
    const events = [makeEvent(), makeEvent(), makeEvent()]
    await pushOk(app, cookie, { events })

    const resumed = await pullOk(app, cookie, { after: '2' })
    expect(resumed.events.map((e) => e.serverSeq)).toEqual([3])
  })

  it('un curseur au-delà du connu resynchronise depuis zéro', async () => {
    // Un curseur plus grand que tout seq connu ne peut venir que d'un état
    // client corrompu : le taire bloquerait la sync en silence pour
    // toujours. `restore()` est idempotent — repartir de zéro est gratuit.
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [makeEvent(), makeEvent()] })

    const pulled = await pullOk(app, cookie, { after: '999999' })
    expect(pulled.events.map((e) => e.serverSeq)).toEqual([1, 2])
  })

  it('un curseur illisible resynchronise depuis zéro', async () => {
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [makeEvent()] })

    for (const after of ['-5', 'abc', '1.5', '']) {
      const pulled = await pullOk(app, cookie, { after })
      expect(pulled.events.map((e) => e.serverSeq)).toEqual([1])
    }
  })
})

describe.skipIf(!adminUrl)('réplication du cache média', () => {
  const row = (ref: string, title: string) => ({
    ref,
    payload: { ref, title, posterPath: null },
  })

  it('réplique une ligne de cache poussée sans événement', async () => {
    // Une mise à jour de cache sans événement se propage aussi : les
    // titres et affiches vivent ici, pas dans le journal.
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [], cacheRows: [row('tmdb:movie/603', 'Matrix')] })

    const pulled = await pullOk(app, cookie)
    expect(pulled.events).toEqual([])
    expect(pulled.cacheRows).toHaveLength(1)
    expect(pulled.cacheRows[0]!.ref).toBe('tmdb:movie/603')
    expect(pulled.cacheRows[0]!.payload).toEqual({
      ref: 'tmdb:movie/603',
      title: 'Matrix',
      posterPath: null,
    })
    expect(pulled.cacheRows[0]!.updatedSeq).toBeGreaterThan(0)
  })

  it('la dernière version gagne et repousse le curseur du cache', async () => {
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [], cacheRows: [row('tmdb:movie/603', 'Matrix')] })
    const before = await pullOk(app, cookie)
    const firstSeq = before.cacheRows[0]!.updatedSeq

    await pushOk(app, cookie, {
      events: [],
      cacheRows: [row('tmdb:movie/603', 'The Matrix')],
    })

    const after = await pullOk(app, cookie)
    expect(after.cacheRows).toHaveLength(1)
    expect(after.cacheRows[0]!.payload).toMatchObject({ title: 'The Matrix' })
    // Le bump du curseur est ce qui fait voir la mise à jour aux autres
    // appareils : sans lui, leur pull incrémental la sauterait.
    expect(after.cacheRows[0]!.updatedSeq).toBeGreaterThan(firstSeq)
  })

  it('le pull incrémental ne rend que les lignes plus fraîches que le curseur', async () => {
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [], cacheRows: [row('tmdb:movie/603', 'Matrix')] })
    const first = await pullOk(app, cookie)
    const cursor = String(first.cacheRows[0]!.updatedSeq)

    await pushOk(app, cookie, { events: [], cacheRows: [row('tmdb:tv/1396', 'Breaking Bad')] })

    const incremental = await pullOk(app, cookie, { cacheAfter: cursor })
    expect(incremental.cacheRows.map((r) => r.ref)).toEqual(['tmdb:tv/1396'])
  })

  it('un curseur de cache inconnu resynchronise le cache depuis zéro', async () => {
    const { app, cookie } = await login()
    await pushOk(app, cookie, { events: [], cacheRows: [row('tmdb:movie/603', 'Matrix')] })

    const pulled = await pullOk(app, cookie, { cacheAfter: '999999' })
    expect(pulled.cacheRows.map((r) => r.ref)).toEqual(['tmdb:movie/603'])
  })

  it('refuse une ligne de cache au-delà de son cap de taille', async () => {
    const { app, cookie } = await login()
    const oversized = {
      ref: 'tmdb:movie/603',
      payload: { blob: 'x'.repeat(20_000) },
    }
    const response = await push(app, cookie, { events: [], cacheRows: [oversized] })
    expect(response.status).toBe(400)
  })
})
