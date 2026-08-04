import { SHARED_TOKEN_HEADER, type MeResponse, type VerifyResponse } from '@owlog/contracts'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { createDb, type Db } from '../db/db.ts'
import { MIGRATIONS_DIR } from '../db/migrate.ts'
import type { MailMessage, Mailer } from '../mail/mailer.ts'
import type { TmdbClient } from '../tmdb.ts'

/**
 * Connexion par fournisseur tiers, contre une vraie base et un faux
 * fournisseur.
 *
 * Ce qui se prouve ici et nulle part ailleurs :
 *
 * - **un e-mail non vérifié ne lie rien.** C'est la seule chose qui sépare
 *   « je possède ce compte Google » de « j'ai tapé cette adresse » ; sans
 *   elle, n'importe qui créant un compte GitHub avec l'adresse d'un autre
 *   prendrait la main sur son journal ;
 * - **GitHub se lit par `/user/emails`, jamais par le champ du profil.**
 *   Le champ public du profil n'est pas vérifié et se change librement ;
 * - **la liaison passe par l'e-mail vérifié** : le même e-mail retrouve le
 *   compte du lien magique, il n'en crée pas un second ;
 * - **sans secrets, le fournisseur n'existe pas** — pas de bouton, donc pas
 *   de chemin qui mène à une erreur de configuration.
 */
const adminUrl = inject('databaseAdminUrl')

const BASE: Config = {
  port: 0,
  tmdbToken: 'tmdb-test-token',
  sharedToken: 'shared-test-token',
  allowedOrigins: [],
  trustedProxies: ['10.0.0.1'],
  basePath: '',
  databaseUrl: undefined,
  publicOrigin: 'https://owlog.test',
  email: undefined,
  oauth: {
    google: { clientId: 'google-id', clientSecret: 'google-secret' },
    github: { clientId: 'github-id', clientSecret: 'github-secret' },
  },
}

const VERIFIER = 'a'.repeat(64)
const CHALLENGE = 'c'.repeat(43)
const STATE = 's'.repeat(32)

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

function captureMailer(): Mailer & { readonly sent: MailMessage[] } {
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

/**
 * Le fournisseur, en dur.
 *
 * Chaque appel sortant est décrit par son URL : l'échange du code, puis la
 * lecture de l'identité. Une URL non prévue fait échouer le test plutôt que
 * de rendre une réponse vide — un appel sortant inattendu est exactement ce
 * qu'on veut voir échouer bruyamment.
 */
function provider(routes: Record<string, unknown>, status = 200): typeof fetch {
  return ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const match = Object.keys(routes).find((key) => url.startsWith(key))
    if (!match) throw new Error(`unexpected outbound call: ${url}`)
    return Promise.resolve(
      new Response(JSON.stringify(routes[match]), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }) as typeof fetch
}

function makeApp(options: { config?: Config; oauthFetch?: typeof fetch } = {}) {
  return createApp({
    config: options.config ?? BASE,
    tmdb: fakeTmdb(),
    db,
    mailer: captureMailer(),
    ...(options.oauthFetch ? { oauthFetch: options.oauthFetch } : {}),
  })
}

type App = ReturnType<typeof makeApp>

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [SHARED_TOKEN_HEADER]: BASE.sharedToken,
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    ...extra,
  }
}

function start(app: App, name: string) {
  return app.fetch(
    new Request(
      `http://local/auth/oauth/${name}/start?challenge=${CHALLENGE}&state=${STATE}`,
      { headers: headers() },
    ),
  )
}

function callback(app: App, name: string, body: unknown = { code: 'the-code', verifier: VERIFIER }) {
  return app.fetch(
    new Request(`http://local/auth/oauth/${name}/callback`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    }),
  )
}

/** Le fournisseur Google nominal : un jeton, puis une identité vérifiée. */
function googleServing(email: string, verified = true): typeof fetch {
  return provider({
    'https://oauth2.googleapis.com/token': { access_token: 'at' },
    'https://openidconnect.googleapis.com/v1/userinfo': { email, email_verified: verified },
  })
}

describe.skipIf(!adminUrl)('oauth — ce qui est offert', () => {
  it('ne liste que les fournisseurs configurés', async () => {
    const app = makeApp({
      config: { ...BASE, oauth: { github: { clientId: 'g', clientSecret: 's' } } },
    })

    const response = await app.fetch(
      new Request('http://local/auth/oauth/providers', { headers: headers() }),
    )

    expect(await response.json()).toEqual({ providers: ['github'] })
  })

  it('n’offre aucun bouton quand aucun secret n’est posé', async () => {
    const app = makeApp({ config: { ...BASE, oauth: {} } })

    const response = await app.fetch(
      new Request('http://local/auth/oauth/providers', { headers: headers() }),
    )

    expect(await response.json()).toEqual({ providers: [] })
  })

  it('construit une URL d’autorisation portant PKCE et l’URI de redirection', async () => {
    const response = await start(makeApp(), 'google')

    expect(response.status).toBe(200)
    const { url } = (await response.json()) as { url: string }
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe('google-id')
    expect(parsed.searchParams.get('code_challenge')).toBe(CHALLENGE)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('state')).toBe(STATE)
    // L'URI de redirection vise LE WEB, jamais l'API : le callback est une
    // navigation, elle ne peut pas porter le jeton partagé.
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://owlog.test/login/oauth/google',
    )
  })

  it('rend 404 pour un fournisseur non configuré, comme pour un inconnu', async () => {
    const app = makeApp({ config: { ...BASE, oauth: {} } })

    expect((await start(app, 'google')).status).toBe(404)
    expect((await start(app, 'myspace')).status).toBe(404)
  })

  it('refuse un défi PKCE trop court', async () => {
    const app = makeApp()

    const response = await app.fetch(
      new Request('http://local/auth/oauth/google/start?challenge=x&state=y', {
        headers: headers(),
      }),
    )

    expect(response.status).toBe(400)
  })
})

describe.skipIf(!adminUrl)('oauth — la liaison', () => {
  it('ouvre une session sur un e-mail vérifié', async () => {
    const app = makeApp({ oauthFetch: googleServing('alex@b.c') })

    const response = await callback(app, 'google')

    expect(response.status).toBe(200)
    const body = (await response.json()) as VerifyResponse
    expect(body.user.email).toBe('alex@b.c')
    expect(response.headers.get('set-cookie')).toContain('owlog_session=')
  })

  it('refuse un e-mail non vérifié, avec un code qui dit quoi faire', async () => {
    const app = makeApp({ oauthFetch: googleServing('alex@b.c', false) })

    const response = await callback(app, 'google')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'oauth-unverified-email' })
  })

  it('retrouve le compte du lien magique au lieu d’en créer un second', async () => {
    // Même e-mail vérifié = même compte. Sans cette règle, se connecter par
    // Google après s'être inscrit par e-mail donnerait un journal vide et
    // un doublon invisible côté serveur.
    const mailer = captureMailer()
    const first = createApp({ config: BASE, tmdb: fakeTmdb(), db, mailer })
    await first.fetch(
      new Request('http://local/auth/request-link', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email: 'alex@b.c', language: 'fr' }),
      }),
    )
    const code = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.subject ?? '')?.[1]
    const verified = await first.fetch(
      new Request('http://local/auth/verify-code', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email: 'alex@b.c', code }),
      }),
    )
    const cookie = verified.headers.get('set-cookie')?.split(';')[0] ?? ''
    await first.fetch(
      new Request('http://local/auth/profile', {
        method: 'POST',
        headers: headers({ cookie }),
        body: JSON.stringify({ pseudo: 'nyx' }),
      }),
    )

    const app = makeApp({ oauthFetch: googleServing('alex@b.c') })
    const response = await callback(app, 'google')

    const oauthCookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
    const me = await app.fetch(
      new Request('http://local/auth/me', { headers: headers({ cookie: oauthCookie }) }),
    )
    // Le pseudo posé par le compte e-mail est là : c'est le même compte.
    expect(((await me.json()) as MeResponse).user?.pseudo).toBe('nyx')
  })

  it('lit l’e-mail GitHub dans /user/emails, jamais dans le profil', async () => {
    // Le champ `email` du profil GitHub est public, modifiable et NON
    // vérifié : le croire suffirait à usurper n'importe quel compte.
    const app = makeApp({
      oauthFetch: provider({
        'https://github.com/login/oauth/access_token': { access_token: 'at' },
        'https://api.github.com/user/emails': [
          { email: 'autre@b.c', primary: false, verified: true },
          { email: 'vrai@b.c', primary: true, verified: true },
        ],
      }),
    })

    const response = await callback(app, 'github')

    expect(response.status).toBe(200)
    expect(((await response.json()) as VerifyResponse).user.email).toBe('vrai@b.c')
  })

  it('refuse GitHub quand l’adresse principale n’est pas vérifiée', async () => {
    const app = makeApp({
      oauthFetch: provider({
        'https://github.com/login/oauth/access_token': { access_token: 'at' },
        'https://api.github.com/user/emails': [
          { email: 'vrai@b.c', primary: true, verified: false },
        ],
      }),
    })

    expect((await callback(app, 'github')).status).toBe(403)
  })

  it('refuse un corps sans vérificateur PKCE', async () => {
    const app = makeApp({ oauthFetch: googleServing('alex@b.c') })

    expect((await callback(app, 'google', { code: 'the-code' })).status).toBe(400)
  })

  it('traduit un refus du fournisseur en 502, jamais en 500', async () => {
    const app = makeApp({
      oauthFetch: provider({ 'https://oauth2.googleapis.com/token': { error: 'invalid_grant' } }, 400),
    })

    const response = await callback(app, 'google')

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upstream-unavailable' })
  })

  it('rend 404 sur un fournisseur non configuré', async () => {
    const app = makeApp({ config: { ...BASE, oauth: {} } })

    expect((await callback(app, 'google')).status).toBe(404)
  })
})
