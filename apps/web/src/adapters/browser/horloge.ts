import { uuidv7 } from 'uuidv7'

import type { GenerateurId, Horloge } from '@/ports/Horloge'

/** Horloge système. */
export const horlogeSysteme: Horloge = {
  maintenant: () => new Date().toISOString(),
}

/**
 * Générateur d'UUIDv7.
 *
 * `crypto.randomUUID()` ne produit que de l'UUIDv4, qui n'est pas
 * ordonnable : deux événements écrits à la même milliseconde n'auraient
 * aucun ordre stable, et la numérotation des cycles changerait d'un rendu à
 * l'autre.
 */
export const generateurUuidv7: GenerateurId = {
  suivant: () => uuidv7(),
}
