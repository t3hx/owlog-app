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
