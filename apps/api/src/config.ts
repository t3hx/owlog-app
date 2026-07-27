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
  }
}

function splitList(value: string | undefined): readonly string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
