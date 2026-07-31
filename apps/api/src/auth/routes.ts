import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

import type { ApiError, AuthUser, MeResponse, VerifyResponse } from '@owlog/contracts'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Pool } from 'pg'
import { uuidv7 } from 'uuidv7'

import { clientIp } from '../clientIp.ts'
import type { Config } from '../config.ts'
import type { Mailer } from '../mail/mailer.ts'
import { loginEmail } from './emailTemplates.ts'

/**
 * Authentification par lien magique + code court.
 *
 * Un e-mail porte DEUX secrets distincts, émis ensemble, expirant
 * ensemble (TTL 15 min), mais consommés indépendamment : sur PWA iOS
 * installée, le lien s'ouvre dans Safari — dont le stockage est isolé de
 * l'app installée — et la session y atterrirait au mauvais endroit. Le
 * code est la voie nominale, le lien le secours.
 *
 * Règles non négociables, chacune couverte par un test de route :
 *
 * - le lien ne se consomme JAMAIS au GET — les scanners d'e-mail
 *   (SafeLinks, antivirus) pré-visitent les liens ;
 * - la réponse de `request-link` est identique que le compte existe ou
 *   non — pas d'énumération d'adresses ;
 * - les compteurs (essais de code, rate-limit) vivent EN BASE — un
 *   redémarrage ne les remet pas à zéro ;
 * - la base ne stocke que des hachés — un dump volé ne donne ni lien,
 *   ni code, ni session ;
 * - `user_id` dérive de la session, jamais d'un corps de requête.
 */
export interface AuthDeps {
  /** Paresseux : la garde `db` de l'app a déjà statué quand on déréférence. */
  readonly pool: () => Pool
  readonly mailer: Mailer
  readonly config: Config
}

export const SESSION_COOKIE = 'owlog_session'

const TOKEN_TTL = '15 minutes'
const MAX_CODE_ATTEMPTS = 5
const SESSION_LIFETIME = '30 days'
const SESSION_SLIDE_THRESHOLD = '29 days'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
/** Fenêtre des limites de `request-link`, alignée sur le TTL des jetons. */
const RATE_WINDOW = '15 minutes'
const RATE_LIMIT_PER_EMAIL = 3
const RATE_LIMIT_PER_IP = 10
const RATE_RETRY_AFTER_SECONDS = 15 * 60

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createAuthRoutes(deps: AuthDeps) {
  const { mailer, config } = deps
  const auth = new Hono()

  auth.post('/request-link', async (c) => {
    const pool = deps.pool()
    const body = await readJson(c)
    const email = normalizeEmail(body?.email)
    const language = body?.language === 'en' ? 'en' : 'fr'
    if (!email) return fail(c, 400, 'bad-request')

    const ip = requestIp(c, config)

    if (await overLimit(pool, 'email', email, RATE_LIMIT_PER_EMAIL)) {
      await audit(pool, 'request-link', email, ip, 'rate-limited-email')
      return tooMany(c)
    }
    if (await overLimit(pool, 'ip', ip, RATE_LIMIT_PER_IP)) {
      await audit(pool, 'request-link', email, ip, 'rate-limited-ip')
      return tooMany(c)
    }

    // Un seul jeton pendant par adresse : une nouvelle demande met les
    // précédents à expiration — `verify-code` n'a ainsi qu'un candidat.
    await pool.query(
      `UPDATE auth_tokens SET expires_at = now()
       WHERE email = $1 AND expires_at > now()`,
      [email],
    )

    const token = randomBytes(32).toString('base64url')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')

    await pool.query(
      `INSERT INTO auth_tokens (id, email, token_hash, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '${TOKEN_TTL}')`,
      [uuidv7(), email, sha256(token), sha256(code)],
    )

    const origin = config.publicOrigin ?? 'http://localhost:5173'
    const link = `${origin}/login/link?token=${token}`

    try {
      await mailer.send(loginEmail({ to: email, code, link, language }))
    } catch {
      await audit(pool, 'request-link', email, ip, 'send-failed')
      return fail(c, 502, 'upstream-unavailable')
    }

    await audit(pool, 'request-link', email, ip, 'sent')
    return c.json({ ok: true })
  })

  auth.post('/verify', async (c) => {
    const pool = deps.pool()
    const body = await readJson(c)
    const token = typeof body?.token === 'string' ? body.token : ''
    if (!token) return fail(c, 400, 'bad-request')

    const ip = requestIp(c, config)

    // Usage unique par UPDATE conditionnel : deux consommations
    // simultanées du même lien ne peuvent pas réussir toutes les deux.
    // Un jeton verrouillé (cinq codes faux) est mort pour le lien aussi :
    // cinq essais, c'est un signal de compromission, pas de maladresse.
    const consumed = await pool.query<{ email: string }>(
      `UPDATE auth_tokens SET token_consumed_at = now()
       WHERE token_hash = $1
         AND token_consumed_at IS NULL
         AND expires_at > now()
         AND attempts < ${MAX_CODE_ATTEMPTS}
       RETURNING email`,
      [sha256(token)],
    )

    const email = consumed.rows[0]?.email
    if (!email) {
      await audit(pool, 'verify-link', null, ip, 'invalid')
      return fail(c, 401, 'auth-invalid')
    }

    const user = await ensureUser(pool, email)
    await openSession(c, pool, user.id)
    await audit(pool, 'verify-link', email, ip, 'ok')

    const response: VerifyResponse = { user: { email: user.email, firstName: user.firstName } }
    return c.json(response)
  })

  auth.post('/verify-code', async (c) => {
    const pool = deps.pool()
    const body = await readJson(c)
    const email = normalizeEmail(body?.email)
    const code = typeof body?.code === 'string' ? body.code.replace(/[\s-]/g, '') : ''
    if (!email || !code) return fail(c, 400, 'bad-request')

    const ip = requestIp(c, config)

    // Le seul jeton pendant de cette adresse — `request-link` a expiré les
    // précédents, le plus récent est donc l'unique candidat.
    const pending = await pool.query<{
      id: string
      code_hash: string
      attempts: number
      code_consumed_at: Date | null
    }>(
      `SELECT id, code_hash, attempts, code_consumed_at FROM auth_tokens
       WHERE email = $1 AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    )

    const row = pending.rows[0]
    if (!row || row.code_consumed_at) {
      await audit(pool, 'verify-code', email, ip, 'invalid')
      return fail(c, 401, 'auth-invalid')
    }

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await audit(pool, 'verify-code', email, ip, 'locked')
      return fail(c, 401, 'auth-locked')
    }

    if (!hashEquals(sha256(code), row.code_hash)) {
      // L'incrément vit en base : un redémarrage ne réarme pas les essais.
      const bumped = await pool.query<{ attempts: number }>(
        `UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
        [row.id],
      )
      const attempts = bumped.rows[0]?.attempts ?? MAX_CODE_ATTEMPTS

      if (attempts >= MAX_CODE_ATTEMPTS) {
        await audit(pool, 'verify-code', email, ip, 'locked')
        return fail(c, 401, 'auth-locked')
      }
      await audit(pool, 'verify-code', email, ip, 'bad-code')
      return fail(c, 401, 'auth-invalid', { attemptsLeft: MAX_CODE_ATTEMPTS - attempts })
    }

    // Usage unique, même règle atomique que le lien.
    const consumed = await pool.query(
      `UPDATE auth_tokens SET code_consumed_at = now()
       WHERE id = $1 AND code_consumed_at IS NULL
       RETURNING id`,
      [row.id],
    )
    if (consumed.rowCount === 0) {
      await audit(pool, 'verify-code', email, ip, 'invalid')
      return fail(c, 401, 'auth-invalid')
    }

    const user = await ensureUser(pool, email)
    await openSession(c, pool, user.id)
    await audit(pool, 'verify-code', email, ip, 'ok')

    const response: VerifyResponse = { user: { email: user.email, firstName: user.firstName } }
    return c.json(response)
  })

  auth.get('/me', async (c) => {
    const pool = deps.pool()
    const user = await sessionUser(pool, c)
    const response: MeResponse = user
      ? { user: { email: user.email, firstName: user.firstName } }
      : { user: null }
    return c.json(response)
  })

  auth.post('/profile', async (c) => {
    const pool = deps.pool()
    const user = await sessionUser(pool, c)
    if (!user) return fail(c, 401, 'unauthorized')

    const body = await readJson(c)
    const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : ''
    if (firstName.length === 0 || firstName.length > 40) return fail(c, 400, 'bad-request')

    // Le serveur fait autorité sur le prénom après connexion : l'écran
    // Réglages pousse ici, et tout appareil relit par /me. La borne de 40
    // est celle du champ de l'onboarding.
    const updated = await pool.query<{ email: string; first_name: string | null }>(
      `UPDATE users SET first_name = $1 WHERE id = $2 RETURNING email, first_name`,
      [firstName, user.id],
    )

    const row = updated.rows[0]!
    const response: VerifyResponse = {
      user: { email: row.email, firstName: row.first_name },
    }
    return c.json(response)
  })

  auth.post('/logout', async (c) => {
    const pool = deps.pool()
    const raw = getCookie(c, SESSION_COOKIE)
    if (raw) {
      await pool.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [sha256(raw)],
      )
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  return auth
}

/**
 * L'utilisateur de la session courante, ou `null`.
 *
 * C'est LA porte d'entrée de l'identité : `user_id` dérive du cookie de
 * session, jamais d'un corps de requête. Les routes `/sync` (F4)
 * passeront par ici.
 *
 * Session glissante : un passage à moins d'un jour du seuil la repousse à
 * trente jours. La borne évite une écriture par requête — la session ne
 * s'étend au plus qu'une fois par jour.
 */
export async function sessionUser(
  pool: Pool,
  c: Context,
): Promise<(AuthUser & { id: string }) | null> {
  const raw = getCookie(c, SESSION_COOKIE)
  if (!raw) return null

  const found = await pool.query<{
    session_id: string
    id: string
    email: string
    first_name: string | null
  }>(
    `SELECT s.id AS session_id, u.id, u.email, u.first_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(raw)],
  )

  const row = found.rows[0]
  if (!row) return null

  await pool.query(
    `UPDATE sessions SET expires_at = now() + interval '${SESSION_LIFETIME}'
     WHERE id = $1 AND expires_at < now() + interval '${SESSION_SLIDE_THRESHOLD}'`,
    [row.session_id],
  )

  return { id: row.id, email: row.email, firstName: row.first_name }
}

/** Compte auto-créé à la première vérification réussie — jamais avant. */
async function ensureUser(
  pool: Pool,
  email: string,
): Promise<{ id: string; email: string; firstName: string | null }> {
  const upserted = await pool.query<{ id: string; email: string; first_name: string | null }>(
    `INSERT INTO users (id, email) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email, first_name`,
    [uuidv7(), email],
  )
  const row = upserted.rows[0]!
  return { id: row.id, email: row.email, firstName: row.first_name }
}

/**
 * Pose une session : le clair part en cookie, la base ne voit que le hash.
 * Un dump volé ne donne aucune session utilisable.
 */
async function openSession(c: Context, pool: Pool, userId: string): Promise<void> {
  const raw = randomBytes(32).toString('base64url')

  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '${SESSION_LIFETIME}')`,
    [uuidv7(), userId, sha256(raw)],
  )

  // `Secure` toujours : les navigateurs traitent localhost comme un
  // contexte sécurisé, le cookie passe aussi en développement.
  setCookie(c, SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

/** Trace d'audit : qui a tenté quoi, d'où, avec quel résultat. */
async function audit(
  pool: Pool,
  kind: string,
  email: string | null,
  ip: string,
  result: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO auth_audit (id, kind, email, ip, result) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), kind, email, ip, result],
  )
}

/**
 * Rate-limit persistant de `request-link`, compté sur le journal d'audit.
 *
 * Seuls les envois réussis (`sent`) comptent : une tentative déjà limitée
 * ne rallonge pas la fenêtre, sinon un attaquant maintiendrait le blocage
 * d'une adresse indéfiniment.
 */
async function overLimit(
  pool: Pool,
  by: 'email' | 'ip',
  value: string,
  limit: number,
): Promise<boolean> {
  const column = by === 'email' ? 'email' : 'ip'
  const counted = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM auth_audit
     WHERE kind = 'request-link' AND result = 'sent'
       AND ${column} = $1 AND created_at > now() - interval '${RATE_WINDOW}'`,
    [value],
  )
  return Number(counted.rows[0]?.n ?? 0) >= limit
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Comparaison en temps constant — même pour des hachés, par principe. */
function hashEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB)
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return EMAIL_SHAPE.test(email) ? email : null
}

function requestIp(c: Context, config: Config): string {
  return clientIp({
    headers: c.req.raw.headers,
    socketAddress: undefined,
    trustedProxies: config.trustedProxies,
  })
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function tooMany(c: Context) {
  c.header('Retry-After', String(RATE_RETRY_AFTER_SECONDS))
  return fail(c, 429, 'rate-limited', { retryAfter: RATE_RETRY_AFTER_SECONDS })
}

function fail(
  c: Context,
  status: 400 | 401 | 429 | 502,
  error: ApiError['error'],
  extra: Partial<Pick<ApiError, 'retryAfter' | 'attemptsLeft'>> = {},
) {
  return c.json({ error, ...extra }, status)
}
