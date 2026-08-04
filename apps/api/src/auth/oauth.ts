import {
  isOAuthProvider,
  oauthCallbackSchema,
  oauthStartQuerySchema,
  OAUTH_PROVIDERS,
  type ApiError,
  type OAuthProvider,
  type OAuthProvidersResponse,
  type OAuthStartResponse,
} from '@owlog/contracts'
import { Hono, type Context } from 'hono'
import type { Pool } from 'pg'

import type { Config, OAuthClient } from '../config.ts'

/**
 * Connexion par fournisseur tiers — Google et GitHub (gate D1.4).
 *
 * **Le callback atterrit sur le web, pas ici** (décision eng F-4.2). Une
 * redirection est une navigation top-level : elle ne porte aucun en-tête,
 * donc pas le jeton partagé qu'exige le middleware `/auth/*`. Le web reçoit
 * `code` et `state`, compare l'état qu'il avait gardé, puis POSTe ici en
 * `fetch` même-origine — exactement le motif de la page d'atterrissage du
 * lien magique.
 *
 * Trois règles non négociables, chacune couverte par un test de route :
 *
 * - **Un e-mail non vérifié ne lie rien.** C'est la seule chose qui sépare
 *   « je possède ce compte » de « j'ai tapé cette adresse ». Sans elle,
 *   créer un compte chez le fournisseur avec l'adresse d'un autre suffirait
 *   à prendre la main sur son journal.
 * - **Chez GitHub, l'adresse se lit dans `/user/emails`.** Le champ `email`
 *   du profil est public, modifiable et non vérifié.
 * - **La liaison passe par l'e-mail vérifié**, et retrouve le compte du
 *   lien magique au lieu d'en créer un second.
 *
 * Ce qui ne vit PAS ici : l'état anti-CSRF et le vérificateur PKCE. Ils
 * restent sur l'appareil entre l'aller et le retour — c'est tout l'intérêt
 * de PKCE, un code intercepté dans l'URL de redirection ne s'échange contre
 * rien sans le vérificateur. Aucune table d'états à faire expirer, donc, et
 * aucun état partagé entre deux répliques du service.
 */
export interface OAuthDeps {
  readonly pool: () => Pool
  readonly config: Config
  /** Injectable : les tests ne doivent joindre aucun fournisseur. */
  readonly fetchImpl?: typeof fetch
  /** Crée ou retrouve le compte d'une adresse, et pose la session. */
  readonly signIn: (c: Context, email: string) => Promise<Response>
  readonly audit: (
    pool: Pool,
    kind: string,
    email: string | null,
    ip: string,
    result: string,
  ) => Promise<void>
  readonly requestIp: (c: Context) => string
}

/** Ce qu'un fournisseur expose, réduit à ce dont le flux a besoin. */
interface ProviderSpec {
  readonly authorizeUrl: string
  readonly tokenUrl: string
  readonly scope: string
  /** Rend l'adresse **vérifiée**, ou `null` si le fournisseur n'en atteste aucune. */
  readonly verifiedEmail: (
    accessToken: string,
    call: typeof fetch,
  ) => Promise<string | null>
}

const SPECS: Record<OAuthProvider, ProviderSpec> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email',
    async verifiedEmail(accessToken, call) {
      const profile = await readJson<{ email?: unknown; email_verified?: unknown }>(
        call('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      )
      if (!profile) return null

      // `email_verified` arrive tantôt en booléen, tantôt en chaîne selon le
      // point d'entrée Google. Seul le vrai franc passe.
      const verified = profile.email_verified === true || profile.email_verified === 'true'
      return verified && typeof profile.email === 'string' ? profile.email : null
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async verifiedEmail(accessToken, call) {
      // JAMAIS `/user`.email : ce champ est public, modifiable et non
      // vérifié. `/user/emails` est le seul endroit où GitHub atteste.
      const emails = await readJson<
        { email?: unknown; primary?: unknown; verified?: unknown }[]
      >(
        call('https://api.github.com/user/emails', {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'owlog',
          },
        }),
      )
      if (!Array.isArray(emails)) return null

      const primary = emails.find(
        (entry) => entry.primary === true && entry.verified === true,
      )
      return typeof primary?.email === 'string' ? primary.email : null
    },
  },
}

export function createOAuthRoutes(deps: OAuthDeps) {
  const oauth = new Hono()
  const call = deps.fetchImpl ?? fetch

  /**
   * Ce que l'écran de connexion a le droit d'afficher.
   *
   * Les non configurés n'apparaissent pas : un bouton qui mène à une erreur
   * de configuration est pire qu'un bouton absent — l'utilisateur croit
   * avoir un chemin, et il n'en a pas.
   */
  oauth.get('/providers', (c) => {
    const providers = OAUTH_PROVIDERS.filter((name) => clientOf(deps.config, name))
    return c.json({ providers } satisfies OAuthProvidersResponse)
  })

  oauth.get('/:provider/start', (c) => {
    const provider = c.req.param('provider')
    if (!isOAuthProvider(provider)) return fail(c, 404, 'not-found')

    const client = clientOf(deps.config, provider)
    // Non configuré et inconnu rendent la même 404 : la configuration du
    // service ne se déduit pas de ses réponses.
    if (!client) return fail(c, 404, 'not-found')

    const query = oauthStartQuerySchema.safeParse({
      challenge: c.req.query('challenge'),
      state: c.req.query('state'),
    })
    if (!query.success) return fail(c, 400, 'bad-request')

    const spec = SPECS[provider]
    const url = new URL(spec.authorizeUrl)
    url.searchParams.set('client_id', client.clientId)
    url.searchParams.set('redirect_uri', redirectUri(deps.config, provider))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', spec.scope)
    url.searchParams.set('state', query.data.state)
    url.searchParams.set('code_challenge', query.data.challenge)
    // S256 seulement : `plain` ne protège de rien, et c'est le seul mode que
    // Google comme GitHub acceptent.
    url.searchParams.set('code_challenge_method', 'S256')

    return c.json({ url: url.href } satisfies OAuthStartResponse)
  })

  oauth.post('/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    if (!isOAuthProvider(provider)) return fail(c, 404, 'not-found')

    const client = clientOf(deps.config, provider)
    if (!client) return fail(c, 404, 'not-found')

    const body = oauthCallbackSchema.safeParse(await parseBody(c))
    if (!body.success) return fail(c, 400, 'bad-request')

    const pool = deps.pool()
    const ip = deps.requestIp(c)
    const kind = `oauth-${provider}`

    const accessToken = await exchange(SPECS[provider], client, {
      code: body.data.code,
      verifier: body.data.verifier,
      redirectUri: redirectUri(deps.config, provider),
      call,
    })

    if (!accessToken) {
      await deps.audit(pool, kind, null, ip, 'exchange-failed')
      return fail(c, 502, 'upstream-unavailable')
    }

    const email = await SPECS[provider].verifiedEmail(accessToken, call)
    if (!email) {
      // 403 et non 401 : le secret était bon, c'est la condition qui manque.
      // L'écran doit dire quoi faire, pas « recommence ».
      await deps.audit(pool, kind, null, ip, 'unverified-email')
      return fail(c, 403, 'oauth-unverified-email')
    }

    const normalized = email.trim().toLowerCase()
    await deps.audit(pool, kind, normalized, ip, 'ok')

    // La liaison est faite par l'adresse : `signIn` retrouve le compte du
    // lien magique s'il existe, et n'en crée un que sinon.
    return deps.signIn(c, normalized)
  })

  return oauth
}

/**
 * L'URI de redirection — celle du **web**, jamais de l'API.
 *
 * Elle doit être déclarée à l'identique dans les consoles Google et GitHub :
 * un écart d'un caractère fait échouer l'autorisation avant même que le
 * service soit appelé.
 *
 * Le repli sur le port de Vite couvre le développement local, où
 * `OWLOG_PUBLIC_ORIGIN` n'est pas posée — même repli que le lien magique,
 * pour que les deux parcours vivent ou meurent ensemble.
 */
function redirectUri(config: Config, provider: OAuthProvider): string {
  const origin = config.publicOrigin ?? 'http://localhost:5173'
  return `${origin}/login/oauth/${provider}`
}

function clientOf(config: Config, provider: OAuthProvider): OAuthClient | undefined {
  return config.oauth[provider]
}

/**
 * Échange le code contre un jeton d'accès.
 *
 * Le secret client ne quitte jamais le service, et le vérificateur PKCE
 * remonte de l'appareil : les deux sont exigés ensemble, si bien qu'un code
 * volé dans l'URL de redirection ne vaut rien sans l'appareil qui l'a
 * demandé.
 */
async function exchange(
  spec: ProviderSpec,
  client: OAuthClient,
  input: {
    code: string
    verifier: string
    redirectUri: string
    call: typeof fetch
  },
): Promise<string | null> {
  const form = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  })

  // `accept: application/json` est vital chez GitHub : sans lui, il répond
  // en `application/x-www-form-urlencoded`, et la lecture JSON rendrait
  // `null` sur un échange pourtant réussi.
  const token = await readJson<{ access_token?: unknown }>(
    input.call(spec.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    }),
  )

  return typeof token?.access_token === 'string' ? token.access_token : null
}

/**
 * Lit une réponse sortante sans jamais lever.
 *
 * Un fournisseur indisponible, une réponse HTML derrière un portail captif
 * ou un 400 avec un corps d'erreur produisent tous `null` — que l'appelant
 * traduit en 502. Une exception ici deviendrait un 500, c'est-à-dire « le
 * service est cassé » là où la vérité est « le fournisseur a refusé ».
 */
async function readJson<T>(pending: Promise<Response>): Promise<T | null> {
  try {
    const response = await pending
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function parseBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function fail(c: Context, status: 400 | 403 | 404 | 502, error: ApiError['error']) {
  return c.json({ error } satisfies ApiError, status)
}
