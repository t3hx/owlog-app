import type { GenerateurId, Horloge } from '@/ports/Horloge'

/**
 * Horloge de test.
 *
 * Avance d'une seconde à chaque lecture, ce qui modélise le fait que deux
 * événements écrits par la même commande se suivent dans le temps sans
 * jamais partager exactement le même instant.
 */
export function horlogeDeTest(depart = '2026-07-27T22:00:00.000Z'): Horloge & {
  avancerDe(secondes: number): void
} {
  let instant = new Date(depart).getTime()

  return {
    maintenant() {
      const courant = new Date(instant).toISOString()
      instant += 1000
      return courant
    },
    avancerDe(secondes) {
      instant += secondes * 1000
    },
  }
}

/**
 * Générateur d'identifiants de test.
 *
 * Séquentiel et zéro-paddé (`id0001`) : ordonnable comme un UUIDv7, et
 * lisible dans un échec de test, ce qu'un vrai UUID ne serait pas.
 */
export function idsDeTest(prefixe = 'id'): GenerateurId {
  let compteur = 0
  return {
    suivant() {
      compteur += 1
      return `${prefixe}${String(compteur).padStart(4, '0')}`
    },
  }
}
