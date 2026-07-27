import type { IdGenerator, Clock } from '@/ports/Clock'

/**
 * Horloge de test.
 *
 * Avance d'une seconde à chaque lecture, ce qui modélise le fait que deux
 * événements écrits par la même commande se suivent dans le temps sans
 * jamais partager exactement le même instant.
 */
export function testClock(depart = '2026-07-27T22:00:00.000Z'): Clock & {
  advanceBy(secondes: number): void
} {
  let at = new Date(depart).getTime()

  return {
    now() {
      const current = new Date(at).toISOString()
      at += 1000
      return current
    },
    advanceBy(secondes) {
      at += secondes * 1000
    },
  }
}

/**
 * Générateur d'identifiants de test.
 *
 * Séquentiel et zéro-paddé (`id0001`) : ordonnable comme un UUIDv7, et
 * lisible dans un échec de test, ce qu'un vrai UUID ne serait pas.
 */
export function testIds(prefix = 'id'): IdGenerator {
  let counter = 0
  return {
    next() {
      counter += 1
      return `${prefix}${String(counter).padStart(4, '0')}`
    },
  }
}
