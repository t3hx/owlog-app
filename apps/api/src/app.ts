import { parseMediaRef, SHARED_TOKEN_HEADER, type ApiError } from '@owlog/contracts'
import { Hono, type Context, type Next } from 'hono'
import { cors } from 'hono/cors'

import { createAuthRoutes } from './auth/routes.ts'
import { createCache } from './cache.ts'
import { clientIp } from './clientIp.ts'
import type { Config } from './config.ts'
import type { Db } from './db/db.ts'
import { createConsoleMailer, type Mailer } from './mail/mailer.ts'
import { createRateLimiter } from './rateLimit.ts'
import { createSocialRoutes } from './social/routes.ts'
import { createSyncRoutes } from './sync/routes.ts'
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
  /**
   * La base, absente quand `DATABASE_URL` n'est pas configurée. Les
   * routes qui la requièrent (`/auth`, `/sync`) dégradent en 503 tant que
   * son état n'est pas `ok` — le pool n'est déréférencé qu'après la garde.
   */
  readonly db?: Pick<Db, 'status' | 'refresh' | 'pool'>
  /** Injectable pour les tests. Sans fournisseur configuré : la console. */
  readonly mailer?: Mailer
  /** Injectable pour les tests : les appels sortants vers Google et GitHub. */
  readonly oauthFetch?: typeof fetch
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

  /**
   * Cache des saisons, séparé du détail : ses clés vivent par saison et non
   * par titre, et le partager brouillerait les comptes de `maxEntries`.
   */
  const seasonCache = createCache<unknown>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: 500,
    ...(options.now ? { now: options.now } : {}),
  })

  const limiter = createRateLimiter({
    limit: 60,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  })

  /**
   * Limiteur propre à `/sync`, séparé de celui de `/search` : une session
   * qui pagine un gros pull ne doit pas manger le quota de recherche, et
   * réciproquement. 120/min laisse passer un resync complet de 10 k
   * événements (20 pages) avec une marge large.
   */
  const syncLimiter = createRateLimiter({
    limit: 120,
    windowMs: 60_000,
    ...(options.now ? { now: options.now } : {}),
  })

  const app = new Hono()

  /**
   * Toutes les routes se déclarent ici, préfixe compris.
   *
   * `basePath` rend une vue de la même application dont les chemins sont
   * décalés ; `app` reste le point d'entrée. Déclarer les routes sur cette
   * vue plutôt que d'ajouter le préfixe à la main dans chaque appel évite
   * la seule erreur qui compte : préfixer les routes en oubliant les
   * middlewares, qui sont montés par motif de chemin et laisseraient alors
   * `/api/search` ouvert sans authentification.
   */
  const routes = config.basePath === '' ? app : app.basePath(config.basePath)

  if (config.allowedOrigins.length > 0) {
    routes.use('*', cors({ origin: [...config.allowedOrigins] }))
  }

  /**
   * Sonde de vie.
   *
   * Avant l'authentification : Dokploy doit pouvoir vérifier que le
   * conteneur répond sans détenir le jeton partagé.
   *
   * C'est une liveness SANS ping de la base, à dessein : si elle en
   * dépendait, Postgres down rendrait la sonde rouge, Dokploy
   * redémarrerait l'API en boucle, et le proxy TMDB du temps 1 mourrait
   * avec la base. L'état de la base vit dans le corps (`db`), en lecture
   * d'état connu ; le rafraîchissement part en arrière-plan, jamais
   * attendu.
   */
  routes.get('/health', (c) => {
    const db = options.db
    if (db) void db.refresh()
    return c.json({ status: 'ok', db: db ? db.status() : 'off' })
  })

  /**
   * Garde des routes à base de données (`/auth`, `/sync`) : 503 franc
   * plutôt que des 500 en cascade tant que la base n'est pas prête.
   */
  const requireDb = (c: Context, next: Next) => {
    const db = options.db
    if (!db || db.status() !== 'ok') {
      if (db) void db.refresh()
      return Promise.resolve(fail(c, 503, 'db-unavailable'))
    }
    return next()
  }

  /**
   * `authenticate` sur `/auth` et `/sync` est le second verrou CSRF, en
   * plus de `SameSite=Lax` : un formulaire cross-site peut envoyer le
   * cookie de session, jamais un en-tête custom — celui-ci exige un
   * `fetch` de notre origine.
   */
  routes.use('/auth/*', authenticate(config), requireDb)
  routes.route(
    '/auth',
    createAuthRoutes({
      // Paresseux : `requireDb` a statué avant toute déréférence.
      pool: () => options.db!.pool,
      mailer: options.mailer ?? createConsoleMailer(),
      config,
      ...(options.oauthFetch ? { oauthFetch: options.oauthFetch } : {}),
    }),
  )

  routes.use('/sync/*', authenticate(config), requireDb, rateLimit(config, syncLimiter))
  routes.route(
    '/sync',
    createSyncRoutes({
      // Paresseux : `requireDb` a statué avant toute déréférence.
      pool: () => options.db!.pool,
    }),
  )

  /**
   * `/social` partage le limiteur de `/sync` plutôt que celui de `/search` :
   * ce sont les routes de session, et un profil consulté ne doit pas
   * entamer le quota de recherche TMDB — ni l'inverse.
   */
  routes.use('/social/*', authenticate(config), requireDb, rateLimit(config, syncLimiter))
  routes.route(
    '/social',
    createSocialRoutes({
      // Paresseux : `requireDb` a statué avant toute déréférence.
      pool: () => options.db!.pool,
    }),
  )

  routes.use('/search', authenticate(config), rateLimit(config, limiter))
  routes.use('/media/*', authenticate(config), rateLimit(config, limiter))

  routes.get('/search', async (c) => {
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

  /**
   * Saison d'une série : rangs et titres d'épisodes, pour la ligne « titre
   * de l'épisode suivant » de la fiche.
   *
   * Le motif décompose la référence (`:source/:id`) au lieu de réutiliser le
   * `:ref{.+}` glouton de la route de détail : deux motifs gloutons qui se
   * recouvrent laissent le routeur de Hono servir le détail — vérifié, pas
   * supposé — et la saison répondrait 400 sur une référence imprononçable.
   * La référence est recomposée puis validée par `parseMediaRef`, comme
   * partout ailleurs.
   */
  routes.get('/media/:source{[a-z]+:[a-z]+}/:id{[0-9]+}/season/:season{[0-9]+}', async (c) => {
    const parsed = parseMediaRef(`${c.req.param('source')}/${c.req.param('id')}`)
    if (!parsed) return fail(c, 400, 'bad-request')

    // Un film n'a pas de saisons. TMDB répondrait 404 ; le dire ici épargne
    // un appel de quota pour une question déjà tranchée par la référence.
    if (parsed.kind !== 'tv') return fail(c, 404, 'not-found')

    const seasonNumber = Number(c.req.param('season'))
    const language = c.req.query('lang') ?? DEFAULT_LANGUAGE
    const key = `${language}::tv/${parsed.id}/season/${seasonNumber}`

    const cached = seasonCache.get(key)
    if (cached) return c.json(cached)

    try {
      const result = await tmdb.season(parsed.id, seasonNumber, language)
      seasonCache.set(key, result)
      return c.json(result)
    } catch (error) {
      return upstream(c, error)
    }
  })

  routes.get('/media/:ref{.+}', async (c) => {
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
  status: 400 | 401 | 404 | 429 | 502 | 503,
  error: ApiError['error'],
  retryAfter?: number,
) {
  const body: ApiError =
    retryAfter === undefined ? { error } : { error, retryAfter }
  return c.json(body, status)
}
