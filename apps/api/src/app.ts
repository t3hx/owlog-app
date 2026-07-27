import { parseMediaRef, SHARED_TOKEN_HEADER, type ApiError } from '@owlog/contracts'
import { Hono, type Context, type Next } from 'hono'
import { cors } from 'hono/cors'

import { createCache } from './cache.ts'
import { clientIp } from './clientIp.ts'
import type { Config } from './config.ts'
import { createRateLimiter } from './rateLimit.ts'
import { createTmdbClient, UpstreamError, type TmdbClient } from './tmdb.ts'

/**
 * Le service.
 *
 * Deux responsabilités, et pas une de plus : **cacher la clé TMDB** et
 * **normaliser sa réponse**. Toute logique métier vit dans le domaine, côté
 * web ; ce service ne sait pas ce qu'est un visionnage.
 *
 * Il deviendra l'API de synchronisation au temps 2. C'est pourquoi il est
 * un vrai service dès maintenant plutôt qu'une fonction serverless : le
 * jour où Postgres arrive, il n'y a rien à déplacer.
 */
export interface AppOptions {
  readonly config: Config
  /** Injectable pour les tests, qui ne doivent pas appeler TMDB. */
  readonly tmdb?: TmdbClient
  readonly now?: () => number
}

/** Langue par défaut si le client n'en demande pas. */
const DEFAULT_LANGUAGE = 'fr-FR'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function createApp(options: AppOptions) {
  const { config } = options
  const tmdb =
    options.tmdb ?? createTmdbClient({ token: config.tmdbToken })

  const searchCache = createCache<unknown>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: 500,
    ...(options.now ? { now: options.now } : {}),
  })
  const detailCache = createCache<unknown>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: 1000,
    ...(options.now ? { now: options.now } : {}),
  })

  const limiter = createRateLimiter({
    limit: 60,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  })

  const app = new Hono()

  if (config.allowedOrigins.length > 0) {
    app.use('*', cors({ origin: [...config.allowedOrigins] }))
  }

  /**
   * Sonde de vie.
   *
   * Avant l'authentification : Dokploy doit pouvoir vérifier que le
   * conteneur répond sans détenir le jeton partagé.
   */
  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.use('/search', authenticate(config), rateLimit(config, limiter))
  app.use('/media/*', authenticate(config), rateLimit(config, limiter))

  app.get('/search', async (c) => {
    const query = c.req.query('q')?.trim()
    if (!query) return fail(c, 400, 'bad-request')

    const language = c.req.query('lang') ?? DEFAULT_LANGUAGE
    const key = `${language}::${query.toLowerCase()}`

    const cached = searchCache.get(key)
    if (cached) return c.json(cached)

    try {
      const result = await tmdb.search(query, language)
      searchCache.set(key, result)
      return c.json(result)
    } catch (error) {
      return upstream(c, error)
    }
  })

  app.get('/media/:ref{.+}', async (c) => {
    const parsed = parseMediaRef(c.req.param('ref'))
    if (!parsed) return fail(c, 400, 'bad-request')

    const language = c.req.query('lang') ?? DEFAULT_LANGUAGE
    const key = `${language}::${parsed.kind}/${parsed.id}`

    const cached = detailCache.get(key)
    if (cached) return c.json(cached)

    try {
      const result = await tmdb.detail(parsed.kind, parsed.id, language)
      detailCache.set(key, result)
      return c.json(result)
    } catch (error) {
      return upstream(c, error)
    }
  })

  return app
}

/**
 * Jeton partagé.
 *
 * Il ne protège rien — il est dans le bundle web, donc public. Il filtre le
 * bruit : un scanner qui trouve l'URL n'ira pas lire le bundle pour
 * continuer. La vraie protection du quota, c'est la limitation de débit.
 */
function authenticate(config: Config) {
  return async (c: Context, next: Next) => {
    if (c.req.header(SHARED_TOKEN_HEADER) !== config.sharedToken) {
      return fail(c, 401, 'unauthorized')
    }
    await next()
  }
}

function rateLimit(config: Config, limiter: ReturnType<typeof createRateLimiter>) {
  return async (c: Context, next: Next) => {
    const ip = clientIp({
      headers: c.req.raw.headers,
      socketAddress: undefined,
      trustedProxies: config.trustedProxies,
    })

    const retryAfter = limiter.check(ip)
    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter))
      return fail(c, 429, 'rate-limited', retryAfter)
    }

    await next()
  }
}

/**
 * Traduit une erreur amont en réponse.
 *
 * Un 429 de TMDB reste un 429 chez nous, avec son `Retry-After` : le client
 * doit pouvoir dire à l'utilisateur combien de temps attendre, pas afficher
 * une panne générique.
 */
function upstream(c: Context, error: unknown) {
  if (error instanceof UpstreamError) {
    if (error.status === 404) return fail(c, 404, 'not-found')

    if (error.status === 429) {
      const retryAfter = error.retryAfter ?? 10
      c.header('Retry-After', String(retryAfter))
      return fail(c, 429, 'rate-limited', retryAfter)
    }
  }

  return fail(c, 502, 'upstream-unavailable')
}

function fail(
  c: Context,
  status: 400 | 401 | 404 | 429 | 502,
  error: ApiError['error'],
  retryAfter?: number,
) {
  const body: ApiError =
    retryAfter === undefined ? { error } : { error, retryAfter }
  return c.json(body, status)
}
