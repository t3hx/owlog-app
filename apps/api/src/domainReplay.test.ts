import { currentStatus, mediaState, type StoredEvent } from '@owlog/domain'
import { createFactory, MOVIE } from '@owlog/domain/test'
import { describe, expect, it } from 'vitest'

/**
 * Rejeu du domaine côté API.
 *
 * Ce test ne vérifie pas une règle métier — les règles ont leurs tests dans
 * `packages/domain`. Il vérifie que l'API **peut consommer le package** :
 * `@owlog/domain` est exporté en source TypeScript sans étape de build, et
 * l'API tourne sous `node --experimental-strip-types`, qui exige des imports
 * relatifs à extension explicite et interdit toute syntaxe non strippable
 * (enum, namespace, paramètres-propriétés). C'est le filet du profil ami :
 * le serveur devra rejouer exactement les mêmes réducteurs que le client.
 */
describe('rejeu du domaine côté serveur', () => {
  it('rejoue une chaîne d événements avec les réducteurs du client', () => {
    const make = createFactory(MOVIE)
    const events: StoredEvent[] = [
      make.watch(),
      make.start('c1'),
      make.seen('c1'),
    ]

    expect(currentStatus(events)).toBe('seen')

    const row = mediaState(events, MOVIE)
    expect(row.status).toBe('seen')
    expect(row.seenCount).toBe(1)
    expect(row.currentCycle).toBe('c1')
  })
})
