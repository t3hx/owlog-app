import type { EventStore } from '@/ports/EventStore'

/**
 * Squelette : le contrat est posé et testé, l'implémentation arrive au
 * commit suivant.
 */
export function creerEventStore(): EventStore {
  return {
    append: () => {
      throw new Error('Pas encore implémenté')
    },
    eventsForMedia: () => {
      throw new Error('Pas encore implémenté')
    },
    allMediaStates: () => {
      throw new Error('Pas encore implémenté')
    },
    eventsSince: () => {
      throw new Error('Pas encore implémenté')
    },
    rebuildAllState: () => {
      throw new Error('Pas encore implémenté')
    },
  }
}
