import { SHARED_TOKEN_HEADER } from '@owlog/contracts'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'

import { createScratchDb, type ScratchDb } from '../../test/scratchDb.ts'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { createDb, type Db } from '../db/db.ts'
import { MIGRATIONS_DIR } from '../db/migrate.ts'
import type { MailMessage, Mailer } from '../mail/mailer.ts'
import type { TmdbClient } from '../tmdb.ts'

/**
 * Les routes d'authentification, contre une vraie base.
 *
 * Le TDD de F3 vit ici : deux secrets indépendants à usage unique, un lien
 * qui ne se consomme jamais au GET, un verrouillage qui survit au
 * redémarrage, des sessions hachées au repos. Chaque test reçoit une base
 * vierge — l'état d'un test ne peut pas en sauver un autre.
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

function fakeTmdb(): TmdbClient {
  return {
    search: async () => ({ hits: [], count: 0 }),
    detail: async () => {
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

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://local${path}`, {
    method: 'POST',
    headers: {
      [SHARED_TOKEN_HEADER]: CONFIG.sharedToken,
      'content-type': 'application/json',
      'cf-connecting-ip': IP,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://local${path}`, {
    headers: {
      [SHARED_TOKEN_HEADER]: CONFIG.sharedToken,
      'cf-connecting-ip': IP,
      ...headers,
    },
  })
}

/** Extrait le code et le jeton du dernier e-mail capturé. */
function secretsOf(mailer: CaptureMailer): { code: string; token: string } {
  const mail = mailer.sent.at(-1)
  if (!mail) throw new Error('no mail captured')
  const code = /\b(\d{6})\b/.exec(mail.subject)?.[1]
  const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1]
  if (!code || !token) throw new Error(`secrets not found in mail: ${mail.subject}`)
  return { code, token }
}

/** La paire `nom=valeur` du cookie de session posé par une réponse. */
function sessionCookie(response: Response): string {
  const header = response.headers.get('set-cookie')
  const pair = header?.split(';')[0]
  if (!pair?.startsWith('owlog_session=')) throw new Error(`no session cookie: ${header}`)
  return pair
}

async function requestLink(app: ReturnType<typeof makeApp>, email = 'a@b.c') {
  const response = await app.fetch(post('/auth/request-link', { email, language: 'fr' }))
  expect(response.status).toBe(200)
}

describe.skipIf(!adminUrl)('demande de lien', () => {
  it('envoie un e-mail portant un lien signé et un code à six chiffres', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)

    const response = await app.fetch(
      post('/auth/request-link', { email: 'Someone@Example.COM', language: 'fr' }),
    )

    expect(response.status).toBe(200)
    expect(mailer.sent).toHaveLength(1)
    const mail = mailer.sent[0]!
    expect(mail.to).toBe('someone@example.com')
    const { code, token } = secretsOf(mailer)
    expect(code).toMatch(/^\d{6}$/)
    expect(mail.text).toContain(`https://owlog.test/login/link?token=${token}`)
    expect(mail.html).toContain(code)
  })

  it("la réponse est identique que le compte existe ou non — pas d'énumération", async () => {
    const app = makeApp()
    await db.pool.query(
      `INSERT INTO users (id, email) VALUES ('01920000-0000-7000-8000-000000000001', 'known@b.c')`,
    )

    const known = await app.fetch(post('/auth/request-link', { email: 'known@b.c' }))
    const unknown = await app.fetch(post('/auth/request-link', { email: 'nobody@b.c' }))

    expect(known.status).toBe(unknown.status)
    expect(await known.json()).toEqual(await unknown.json())
  })

  it('ne stocke que des hachés — un dump volé ne donne ni lien ni code', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)

    const { code, token } = secretsOf(mailer)
    const { rows } = await db.pool.query(
      'SELECT token_hash, code_hash, expires_at FROM auth_tokens',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toContain(token)
    expect(rows[0].code_hash).not.toContain(code)
    // TTL 15 minutes, pas plus.
    const ttlMs = new Date(rows[0].expires_at).getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(13 * 60_000)
    expect(ttlMs).toBeLessThan(16 * 60_000)
  })

  it("le gabarit suit la langue demandée", async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)

    await app.fetch(post('/auth/request-link', { email: 'a@b.c', language: 'en' }))

    expect(mailer.sent[0]!.subject).toMatch(/sign-in/i)
  })

  it('refuse une adresse invalide sans envoyer', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)

    const response = await app.fetch(post('/auth/request-link', { email: 'pas-une-adresse' }))

    expect(response.status).toBe(400)
    expect(mailer.sent).toHaveLength(0)
  })

  it('limite les demandes par adresse destinataire — anti-bombardement', async () => {
    const app = makeApp()

    for (let i = 0; i < 3; i += 1) await requestLink(app)
    const fourth = await app.fetch(post('/auth/request-link', { email: 'a@b.c' }))

    expect(fourth.status).toBe(429)
    expect(Number(fourth.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('limite les demandes par IP, même vers des adresses différentes', async () => {
    const app = makeApp()

    for (let i = 0; i < 10; i += 1) await requestLink(app, `dest${i}@b.c`)
    const eleventh = await app.fetch(post('/auth/request-link', { email: 'dest10@b.c' }))

    expect(eleventh.status).toBe(429)
  })

  it('le rate-limit est persistant : il compte en base, pas en mémoire', async () => {
    const app = makeApp()
    for (let i = 0; i < 3; i += 1) await requestLink(app)

    // Un redémarrage du service : nouvelle instance, même base.
    const restarted = makeApp()
    const after = await restarted.fetch(post('/auth/request-link', { email: 'a@b.c' }))

    expect(after.status).toBe(429)
  })

  it("journalise la tentative — IP et résultat", async () => {
    const app = makeApp()
    await requestLink(app)

    const { rows } = await db.pool.query(
      `SELECT kind, email, ip, result FROM auth_audit`,
    )
    expect(rows).toContainEqual({
      kind: 'request-link',
      email: 'a@b.c',
      ip: IP,
      result: 'sent',
    })
  })
})

describe.skipIf(!adminUrl)('vérification du lien', () => {
  it("un POST du jeton crée le compte, pose la session et rend l'utilisateur", async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { token } = secretsOf(mailer)

    const response = await app.fetch(post('/auth/verify', { token }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: { email: 'a@b.c', firstName: null },
    })

    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain('owlog_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')

    const users = await db.pool.query('SELECT email FROM users')
    expect(users.rows).toEqual([{ email: 'a@b.c' }])
  })

  it('GET /auth/verify n’existe pas — un scanner d’e-mail ne consomme rien', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { token } = secretsOf(mailer)

    // SafeLinks, antivirus : ils suivent les liens en GET. Rien ne doit
    // se consommer.
    const scanned = await app.fetch(get(`/auth/verify?token=${token}`))
    expect(scanned.status).toBe(404)

    const human = await app.fetch(post('/auth/verify', { token }))
    expect(human.status).toBe(200)
  })

  it('le jeton est à usage unique', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { token } = secretsOf(mailer)

    await app.fetch(post('/auth/verify', { token }))
    const second = await app.fetch(post('/auth/verify', { token }))

    expect(second.status).toBe(401)
    await expect(second.json()).resolves.toEqual({ error: 'auth-invalid' })
  })

  it('consommer le lien ne brûle pas le code — le cas PWA iOS', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { token, code } = secretsOf(mailer)

    // Le lien s'ouvre dans Safari (stockage isolé de la PWA installée)…
    const safari = await app.fetch(post('/auth/verify', { token }))
    expect(safari.status).toBe(200)

    // …et la PWA reste connectable par le code.
    const pwa = await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code }))
    expect(pwa.status).toBe(200)
  })

  it('un jeton expiré est refusé', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { token } = secretsOf(mailer)
    await db.pool.query(`UPDATE auth_tokens SET expires_at = now() - interval '1 minute'`)

    const response = await app.fetch(post('/auth/verify', { token }))

    expect(response.status).toBe(401)
  })

  it('un jeton inconnu est refusé', async () => {
    const app = makeApp()

    const response = await app.fetch(post('/auth/verify', { token: 'n-importe-quoi' }))

    expect(response.status).toBe(401)
  })
})

describe.skipIf(!adminUrl)('vérification du code', () => {
  it('un code juste pose la session', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { code } = secretsOf(mailer)

    const response = await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code }))

    expect(response.status).toBe(200)
    expect(sessionCookie(response)).toContain('owlog_session=')
  })

  it("tolère les espaces du collage et la casse de l'adresse", async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { code } = secretsOf(mailer)
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

    const response = await app.fetch(
      post('/auth/verify-code', { email: '  A@B.C ', code: ` ${spaced} ` }),
    )

    expect(response.status).toBe(200)
  })

  it('un code faux décompte les essais et le dit', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)

    const response = await app.fetch(
      post('/auth/verify-code', { email: 'a@b.c', code: '000000' }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'auth-invalid',
      attemptsLeft: 4,
    })
  })

  it('cinq codes faux verrouillent le jeton — même le bon code est refusé', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { code } = secretsOf(mailer)

    for (let i = 0; i < 5; i += 1) {
      await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code: '000000' }))
    }
    const locked = await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code }))

    expect(locked.status).toBe(401)
    await expect(locked.json()).resolves.toEqual({ error: 'auth-locked' })
  })

  it('le verrouillage survit à un redémarrage du service', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { code } = secretsOf(mailer)
    for (let i = 0; i < 5; i += 1) {
      await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code: '000000' }))
    }

    // Redémarrage : le compteur vit dans auth_tokens, pas dans une Map.
    const restarted = makeApp()
    const locked = await restarted.fetch(post('/auth/verify-code', { email: 'a@b.c', code }))

    expect(locked.status).toBe(401)
    await expect(locked.json()).resolves.toEqual({ error: 'auth-locked' })
  })

  it('le code est à usage unique', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    await requestLink(app)
    const { code } = secretsOf(mailer)

    await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code }))
    const second = await app.fetch(post('/auth/verify-code', { email: 'a@b.c', code }))

    expect(second.status).toBe(401)
  })

  it('un code pour une adresse sans demande en cours est refusé', async () => {
    const app = makeApp()

    const response = await app.fetch(
      post('/auth/verify-code', { email: 'jamais-vu@b.c', code: '123456' }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'auth-invalid' })
  })
})

describe.skipIf(!adminUrl)('session', () => {
  async function connectedCookie(app: ReturnType<typeof makeApp>, mailer: CaptureMailer) {
    await requestLink(app)
    const { token } = secretsOf(mailer)
    const response = await app.fetch(post('/auth/verify', { token }))
    return sessionCookie(response)
  }

  it('/auth/me sans cookie répond user: null — pas une erreur', async () => {
    const app = makeApp()

    const response = await app.fetch(get('/auth/me'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ user: null })
  })

  it("/auth/me avec session rend l'utilisateur ; la base ne stocke que le hash", async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)

    const response = await app.fetch(get('/auth/me', { cookie }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: { email: 'a@b.c', firstName: null },
    })

    const raw = cookie.split('=')[1]!
    const { rows } = await db.pool.query('SELECT token_hash FROM sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toContain(raw)
  })

  it('la session glisse : proche de sa fin, un passage la repousse à trente jours', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)
    await db.pool.query(`UPDATE sessions SET expires_at = now() + interval '1 day'`)

    await app.fetch(get('/auth/me', { cookie }))

    const { rows } = await db.pool.query(
      `SELECT (expires_at > now() + interval '29 days') AS extended FROM sessions`,
    )
    expect(rows[0].extended).toBe(true)
  })

  it('une session expirée est refusée', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)
    await db.pool.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`)

    const response = await app.fetch(get('/auth/me', { cookie }))

    await expect(response.json()).resolves.toEqual({ user: null })
  })

  it('logout révoque la session et efface le cookie', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)

    const logout = await app.fetch(post('/auth/logout', {}, { cookie }))
    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const { rows } = await db.pool.query('SELECT revoked_at FROM sessions')
    expect(rows[0].revoked_at).not.toBeNull()

    // Le cookie volé ou resté dans un onglet ne vaut plus rien.
    const after = await app.fetch(get('/auth/me', { cookie }))
    await expect(after.json()).resolves.toEqual({ user: null })
  })

  it("les routes auth exigent l'en-tête partagé — le second verrou CSRF", async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)

    // Un formulaire cross-site peut envoyer le cookie, jamais un en-tête
    // custom : sans lui, refus — même avec une session valide.
    const response = await app.fetch(
      new Request('http://local/auth/logout', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    )

    expect(response.status).toBe(401)
  })

  it('le profil se met à jour — le serveur fait autorité sur le prénom', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)

    const updated = await app.fetch(post('/auth/profile', { firstName: 'Alex' }, { cookie }))

    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toEqual({
      user: { email: 'a@b.c', firstName: 'Alex' },
    })

    // /auth/me rend la valeur écrite : c'est elle que tout appareil relit.
    const me = await app.fetch(get('/auth/me', { cookie }))
    await expect(me.json()).resolves.toEqual({
      user: { email: 'a@b.c', firstName: 'Alex' },
    })
  })

  it('le profil exige une session — jamais un user_id de corps de requête', async () => {
    const app = makeApp()

    const response = await app.fetch(post('/auth/profile', { firstName: 'Alex' }))

    expect(response.status).toBe(401)
  })

  it('le profil refuse un prénom vide ou démesuré', async () => {
    const mailer = captureMailer()
    const app = makeApp(mailer)
    const cookie = await connectedCookie(app, mailer)

    const empty = await app.fetch(post('/auth/profile', { firstName: '   ' }, { cookie }))
    const huge = await app.fetch(
      post('/auth/profile', { firstName: 'x'.repeat(41) }, { cookie }),
    )

    expect(empty.status).toBe(400)
    expect(huge.status).toBe(400)
  })
})

describe.skipIf(!adminUrl)('auth et base', () => {
  it('/auth répond 503 quand la base est down', async () => {
    const app = createApp({
      config: CONFIG,
      tmdb: fakeTmdb(),
      mailer: captureMailer(),
      db: {
        status: () => 'down',
        refresh: async () => {},
        pool: db.pool,
      },
    })

    const response = await app.fetch(post('/auth/request-link', { email: 'a@b.c' }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'db-unavailable' })
  })

  it('un corps non-JSON est un 400, pas un 500', async () => {
    const app = makeApp()

    const response = await app.fetch(
      new Request('http://local/auth/verify', {
        method: 'POST',
        headers: {
          [SHARED_TOKEN_HEADER]: CONFIG.sharedToken,
          'cf-connecting-ip': IP,
        },
        body: 'pas du json',
      }),
    )

    expect(response.status).toBe(400)
  })
})
