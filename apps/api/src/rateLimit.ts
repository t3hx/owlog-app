/**
 * Limitation de débit par fenêtre glissante.
 *
 * Elle protège le **quota TMDB**, pas le serveur. Le service tient sans
 * effort la charge d'un utilisateur unique ; ce qui s'épuise, c'est la clé
 * du fournisseur, et elle s'épuise pour tout le monde à la fois.
 *
 * Fenêtre glissante et non compteur par tranche fixe : avec des tranches,
 * un client peut envoyer la limite entière à la fin d'une tranche puis
 * autant au début de la suivante, soit le double du débit annoncé sur la
 * charnière.
 */
export interface RateLimiter {
  /** Rend `null` si la requête passe, sinon le délai d'attente en secondes. */
  check(key: string): number | null
}

export function createRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
}): RateLimiter {
  const hits = new Map<string, number[]>()
  const now = options.now ?? (() => Date.now())

  return {
    check(key) {
      const current = now()
      const since = current - options.windowMs

      const previous = hits.get(key) ?? []
      const recent = previous.filter((at) => at > since)

      if (recent.length >= options.limit) {
        const oldest = recent[0] ?? current
        const retryAfter = Math.ceil((oldest + options.windowMs - current) / 1000)
        // Au moins une seconde : un `Retry-After: 0` invite le client à
        // réessayer immédiatement, ce qui produit une boucle serrée.
        return Math.max(1, retryAfter)
      }

      recent.push(current)
      hits.set(key, recent)

      // Purge opportuniste : sans elle, la Map grossit d'une entrée par IP
      // vue, pour toujours.
      if (hits.size > 1000) {
        for (const [otherKey, timestamps] of hits) {
          if (timestamps.every((at) => at <= since)) hits.delete(otherKey)
        }
      }

      return null
    },
  }
}
