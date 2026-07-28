/**
 * Cache mémoire à durée de vie.
 *
 * En mémoire et non sur disque : le service est mono-instance, redémarre en
 * quelques secondes, et un cache froid après redéploiement coûte quelques
 * appels TMDB. Un cache persistant serait une pièce de plus à opérer pour
 * un gain qui ne se mesure pas.
 *
 * Sa vraie fonction n'est pas la latence, c'est le **quota**. TMDB limite
 * les appels ; une recherche par frappe, même anti-rebondie, épuiserait la
 * clé bien avant d'être lente.
 */
export interface Cache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  /** Nombre d'entrées vivantes. Sert au diagnostic. */
  size(): number
}

interface Entry<T> {
  readonly value: T
  readonly expiresAt: number
}

export function createCache<T>(options: {
  ttlMs: number
  maxEntries: number
  now?: () => number
}): Cache<T> {
  const entries = new Map<string, Entry<T>>()
  const now = options.now ?? (() => Date.now())

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined

      if (entry.expiresAt <= now()) {
        entries.delete(key)
        return undefined
      }

      // Réinsertion : la Map conserve l'ordre d'insertion, ce qui suffit à
      // faire de l'éviction du plus ancien un LRU sans structure dédiée.
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },

    set(key, value) {
      entries.delete(key)
      entries.set(key, { value, expiresAt: now() + options.ttlMs })

      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },

    size() {
      return entries.size
    },
  }
}
