import { SHARED_TOKEN_HEADER, type PushRequest, type SerializedEvent } from '@owlog/contracts'
import type { PublicProfileView } from '@owlog/domain'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { createDb, type Db } from '../db/db.ts'
import { MIGRATIONS_DIR } from '../db/migrate.ts'
import type { MailMessage, Mailer } from '../mail/mailer.ts'
import type { TmdbClient } from '../tmdb.ts'

/**
 * La route de profil, contre une vraie base.
 *
 * Ce qui se prouve ici et nulle part ailleurs : le serveur rejoue bien les
 * réducteurs du domaine sur des lignes de `events`, et la règle « privé =
 * inexistant » ne laisse fuir aucun signal d'existence. Les règles de
 * projection, elles, ont leurs tests dans `packages/domain`.
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
}

const IP = '203.0.113.7'
const MOVIE = 'tmdb:movie/603'

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

/** Un compte connecté, avec son pseudo posé. */
async function member(
  email: string,
  pseudo: string,
): Promise<{ app: App; cookie: string }> {
  const mailer = captureMailer()
  const app = makeApp(mailer)

  await app.fetch(
    new Request('http://local/auth/request-link', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, language: 'fr' }),
    }),
  )
  const mail = mailer.sent.at(-1)
  if (!mail) throw new Error('no mail captured')
  const code = /\b(\d{6})\b/.exec(mail.subject)?.[1]
  if (!code) throw new Error('no code in mail')

  const verified = await app.fetch(
    new Request('http://local/auth/verify-code', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ email, code }),
    }),
  )
  const cookie = verified.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('no session cookie')

  const named = await app.fetch(
    new Request('http://local/auth/profile', {
      method: 'POST',
      headers: headers({ cookie }),
      body: JSON.stringify({ firstName: 'Alex', pseudo }),
    }),
  )
  expect(named.status).toBe(200)

  return { app, cookie }
}

let eventCounter = 0

function event(overrides: Partial<SerializedEvent> = {}): SerializedEvent {
  eventCounter += 1
  const suffix = String(eventCounter).padStart(12, '0')
  return {
    id: `01920000-0000-7000-8000-${suffix}`,
    device_id: 'device-a',
    type: 'WATCH',
    media_ref: MOVIE,
    cycle_key: null,
    created_at: '2026-07-30T12:00:00.000Z',
    occurred_at: '2026-07-30T12:00:00.000Z',
    occurred_precision: 'exact',
    ...overrides,
  }
}

async function push(app: App, cookie: string, body: PushRequest) {
  const response = await app.fetch(
    new Request('http://local/sync/events', {
      method: 'POST',
      headers: headers({ cookie }),
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
}

function profile(app: App, cookie: string, pseudo: string) {
  return app.fetch(
    new Request(`http://local/social/profile/${pseudo}`, { headers: headers({ cookie }) }),
  )
}

describe.skipIf(!adminUrl)('profil — visibilité', () => {
  it('rend son propre profil, sans tuile compat', async () => {
    const { app, cookie } = await member('me@b.c', 'nyx')

    const response = await profile(app, cookie, 'nyx')

    expect(response.status).toBe(200)
    const view = (await response.json()) as PublicProfileView
    expect(view.kind).toBe('own')
    expect(view).not.toHaveProperty('compat')
  })

  it('accepte un pseudo saisi en majuscules dans l URL', async () => {
    const { app, cookie } = await member('me@b.c', 'nyx')

    expect((await profile(app, cookie, 'NYX')).status).toBe(200)
  })

  it('rend 404 pour un compte sans relation, comme pour un pseudo inconnu', async () => {
    // « Privé = inexistant » : les deux réponses doivent être indiscernables,
    // sinon deviner des pseudos suffit à cartographier les comptes.
    await member('other@b.c', 'other')
    const { app, cookie } = await member('me@b.c', 'nyx')

    const stranger = await profile(app, cookie, 'other')
    const unknown = await profile(app, cookie, 'personne')

    expect(stranger.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await stranger.json()).toEqual(await unknown.json())
  })

  it('rend 404 et non 400 sur un pseudo hors format', async () => {
    // Un 400 apprendrait au visiteur à distinguer « mal écrit » d'« inconnu ».
    const { app, cookie } = await member('me@b.c', 'nyx')

    const response = await profile(app, cookie, 'AB')

    expect(response.status).toBe(404)
  })

  it('exige une session', async () => {
    await member('me@b.c', 'nyx')
    const app = makeApp()

    const response = await app.fetch(
      new Request('http://local/social/profile/nyx', { headers: headers() }),
    )

    expect(response.status).toBe(401)
  })
})

describe.skipIf(!adminUrl)('profil — rejeu du domaine côté serveur', () => {
  it('dérive les compteurs des événements poussés, pas d une colonne stockée', async () => {
    const { app, cookie } = await member('me@b.c', 'nyx')

    await push(app, cookie, {
      events: [
        event({ type: 'WATCH' }),
        event({ type: 'START', cycle_key: 'c1' }),
        event({ type: 'SEEN', cycle_key: 'c1' }),
        event({ type: 'FAV' }),
      ],
      cacheRows: [
        { ref: MOVIE, payload: { title: 'Le Parrain', posterPath: '/p.jpg', year: 1972 } },
      ],
    })

    const view = (await (await profile(app, cookie, 'nyx')).json()) as PublicProfileView

    if (view.kind !== 'own') throw new Error('expected own profile')
    expect(view.seenCount).toBe(1)
    expect(view.favoriteCount).toBe(1)
    expect(view.loggedCount).toBe(1)
    expect(view.favorites).toEqual([
      { ref: MOVIE, title: 'Le Parrain', posterPath: '/p.jpg', year: 1972 },
    ])
  })

  it('ne laisse pas fuir le texte d une note par la route', async () => {
    // Le filet de bout en bout : la projection le garantit, cette route le
    // vérifie sur le vrai chemin — base, sérialisation, réponse HTTP.
    const secret = 'NOTE-PRIVEE-QUI-NE-DOIT-PAS-SORTIR'
    const { app, cookie } = await member('me@b.c', 'nyx')

    await push(app, cookie, {
      events: [
        event({ type: 'WATCH' }),
        event({ type: 'START', cycle_key: 'c1' }),
        event({ type: 'NOTE', cycle_key: 'c1', payload: { text: secret } }),
      ],
      cacheRows: [],
    })

    const response = await profile(app, cookie, 'nyx')

    expect(await response.text()).not.toContain(secret)
  })

  it('survit a une ligne de cache que le serveur ne sait pas lire', async () => {
    // `media_cache.payload` est du jsonb opaque, écrit par des versions
    // successives du client : la route doit rendre `null`, pas planter.
    const { app, cookie } = await member('me@b.c', 'nyx')

    await push(app, cookie, {
      events: [event({ type: 'WATCH' }), event({ type: 'FAV' })],
      cacheRows: [{ ref: MOVIE, payload: { title: 42, posterPath: [], year: 'mille' } }],
    })

    const view = (await (await profile(app, cookie, 'nyx')).json()) as PublicProfileView

    if (view.kind !== 'own') throw new Error('expected own profile')
    expect(view.favorites).toEqual([{ ref: MOVIE, title: null, posterPath: null, year: null }])
  })
})
