/**
 * Configuration du service, lue une fois au démarrage.
 *
 * Tout vient de l'environnement, qui vient de Doppler. Aucun secret n'est
 * versionné, et le service refuse de démarrer plutôt que de tourner à
 * moitié : une clé TMDB absente donnerait des 500 silencieux sur chaque
 * recherche, ce qui se diagnostique bien plus mal qu'un refus au démarrage.
 */
export interface Config {
  readonly port: number
  readonly tmdbToken: string
  /** Origines autorisées en CORS. Vide en développement local. */
  readonly allowedOrigins: readonly string[]
  /**
   * Jeton partagé attendu des clients.
   *
   * Public par nature — il est injecté dans le bundle web, donc lisible par
   * quiconque ouvre les outils de développement. Il ne protège pas le
   * service, il filtre le bruit : un scanner qui trouve l'URL n'ira pas
   * jusqu'à lire le bundle.
   */
  readonly sharedToken: string
  /** Proxies devant le service, dont on accepte l'en-tête d'IP réelle. */
  readonly trustedProxies: readonly string[]
  /**
   * Préfixe sous lequel le service se monte, `''` pour la racine.
   *
   * En production, `owlog-api` partage son domaine avec `owlog-web` et vit
   * sous `/api`. Il s'y monte **lui-même** plutôt que de compter sur le
   * proxy pour retirer le préfixe : rien ne garantit qu'un « Strip Path »
   * existe dans l'orchestrateur, et une hypothèse sur l'infrastructure ne
   * se vérifie qu'après un cycle de déploiement complet. En se montant
   * lui-même, le service répond juste que le préfixe soit retiré ou non.
   */
  readonly basePath: string
  /**
   * URL de connexion Postgres, absente tant que le déploiement n'a pas de
   * base. Optionnelle à dessein — contrairement aux secrets TMDB : le
   * compte est optionnel côté produit, et le proxy TMDB du temps 1 doit
   * démarrer et vivre sans base. Sans elle, `/sync` répond 503 et tout le
   * reste fonctionne.
   */
  readonly databaseUrl: string | undefined
  /**
   * Origine publique de l'app web, pour construire le lien magique des
   * e-mails (`https://owlog.nspace.link`). Jamais déduite de la requête :
   * derrière le tunnel, l'origine parle HTTP en clair et un lien `http://`
   * en production serait faux. Absente en développement — le lien tombe
   * sur l'origine du serveur Vite.
   */
  readonly publicOrigin: string | undefined
  /** Fournisseur d'e-mail (format Resend). Absent : mailer console. */
  readonly email:
    | { readonly apiUrl: string; readonly apiToken: string; readonly from: string }
    | undefined
  /**
   * Fournisseurs OAuth configurés, par nom.
   *
   * **Absents par défaut, et chacun en tout ou rien.** Un identifiant sans
   * secret ne peut pas échanger un code : le fournisseur mènerait à un
   * échec au dernier pas du parcours, après la redirection, quand
   * l'utilisateur croit s'être déjà connecté. Le démarrage refuse donc la
   * moitié d'un couple, et un fournisseur entièrement absent n'est
   * simplement pas offert.
   */
  readonly oauth: OAuthConfig
}

export interface OAuthClient {
  readonly clientId: string
  readonly clientSecret: string
}

export interface OAuthConfig {
  readonly google?: OAuthClient
  readonly github?: OAuthClient
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tmdbToken = env.TMDB_API_TOKEN
  if (!tmdbToken) {
    throw new Error(
      'TMDB_API_TOKEN is missing. Run the service through Doppler: doppler run -- pnpm dev',
    )
  }

  const sharedToken = env.OWLOG_SHARED_TOKEN
  if (!sharedToken) {
    throw new Error('OWLOG_SHARED_TOKEN is missing. Set it in Doppler.')
  }

  return {
    port: Number(env.PORT ?? 8787),
    tmdbToken,
    sharedToken,
    allowedOrigins: splitList(env.OWLOG_ALLOWED_ORIGINS),
    trustedProxies: splitList(env.OWLOG_TRUSTED_PROXIES),
    basePath: normalizeBasePath(env.OWLOG_BASE_PATH),
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    publicOrigin: env.OWLOG_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') || undefined,
    email: loadEmail(env),
    oauth: loadOAuth(env),
  }
}

/**
 * Les couples identifiant/secret des fournisseurs.
 *
 * Un couple incomplet **empêche le démarrage** plutôt que de désactiver
 * silencieusement le fournisseur : la moitié d'une configuration est
 * toujours une erreur de saisie, jamais une intention. La désactiver en
 * silence rendrait le bouton absent sans que personne comprenne pourquoi —
 * et on chercherait dans le code avant de regarder Doppler.
 */
function loadOAuth(env: NodeJS.ProcessEnv): OAuthConfig {
  return {
    ...client('google', env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET),
    ...client('github', env.GITHUB_OAUTH_CLIENT_ID, env.GITHUB_OAUTH_CLIENT_SECRET),
  }
}

function client(
  name: 'google' | 'github',
  rawId: string | undefined,
  rawSecret: string | undefined,
): OAuthConfig {
  const clientId = rawId?.trim()
  const clientSecret = rawSecret?.trim()

  if (!clientId && !clientSecret) return {}
  if (!clientId || !clientSecret) {
    throw new Error(
      `${name.toUpperCase()}_OAUTH_CLIENT_ID and ${name.toUpperCase()}_OAUTH_CLIENT_SECRET ` +
        'must be set together. Set both in Doppler, or neither.',
    )
  }

  return { [name]: { clientId, clientSecret } }
}

/**
 * Le fournisseur d'e-mail se configure en tout ou rien : un jeton sans
 * expéditeur enverrait des messages refusés par le fournisseur, et un
 * fournisseur sans origine publique fabriquerait des liens localhost dans
 * de vrais e-mails. Refuser de démarrer coûte moins cher que diagnostiquer
 * l'un ou l'autre en production.
 */
function loadEmail(env: NodeJS.ProcessEnv): Config['email'] {
  const apiToken = env.OWLOG_EMAIL_API_TOKEN?.trim()
  if (!apiToken) return undefined

  const from = env.OWLOG_EMAIL_FROM?.trim()
  if (!from) {
    throw new Error('OWLOG_EMAIL_FROM is missing while OWLOG_EMAIL_API_TOKEN is set.')
  }
  if (!env.OWLOG_PUBLIC_ORIGIN?.trim()) {
    throw new Error('OWLOG_PUBLIC_ORIGIN is missing while OWLOG_EMAIL_API_TOKEN is set.')
  }

  return {
    apiUrl: env.OWLOG_EMAIL_API_URL?.trim() || 'https://api.resend.com/emails',
    apiToken,
    from,
  }
}

/**
 * Normalise un préfixe saisi à la main.
 *
 * La valeur vient d'un champ d'interface web, donc elle arrive écrite
 * tantôt `api`, tantôt `/api/`, parfois entourée d'espaces. Une comparaison
 * de chemins ne pardonne aucun de ces écarts, et l'erreur se manifeste par
 * un `404` sur toutes les routes — un symptôme qu'on attribue au proxy
 * avant de penser à une barre oblique.
 *
 * `/` seul vaut absence de préfixe : dans un champ « chemin », il désigne
 * la racine. Le monter tel quel doublerait la barre et plus aucune route ne
 * correspondrait.
 *
 * Ce qui n'est pas un chemin fait **échouer le démarrage**. Le cas vu en
 * vrai : une valeur recopiée depuis un export `.env`, guillemets compris,
 * qui monte le service sous `/"/api"`. Il répond alors `404` sur tout — et
 * un `404` ressemble à un problème de routage, si bien qu'on cherche du
 * côté du proxy pendant que la cause est dans un champ de formulaire. Mieux
 * vaut ne pas démarrer que démarrer sous un chemin que personne n'appellera.
 */
const VALID_BASE_PATH = /^\/[A-Za-z0-9\-._~/]*$/

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '' || trimmed === '/') return ''

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '')

  if (!VALID_BASE_PATH.test(withoutTrailingSlash)) {
    throw new Error(
      `OWLOG_BASE_PATH is not a usable path: ${JSON.stringify(value)}. ` +
        'Enter it unquoted, as /api — surrounding quotes from a .env export ' +
        'become part of the value.',
    )
  }

  return withoutTrailingSlash
}

function splitList(value: string | undefined): readonly string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
