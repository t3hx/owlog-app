import { uuidv7 } from 'uuidv7'

import type { IdGenerator, Clock } from '@/ports/Clock'

/** Horloge système. */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
}

/**
 * Générateur d'UUIDv7.
 *
 * `crypto.randomUUID()` ne produit que de l'UUIDv4, qui n'est pas
 * ordonnable : deux événements écrits à la même milliseconde n'auraient
 * aucun ordre stable, et la numérotation des cycles changerait d'un rendu à
 * l'autre.
 */
export const uuidv7Generator: IdGenerator = {
  next: () => uuidv7(),
}
