import { describe, expect, it } from 'vitest'

import { mediaState } from './mediaState.ts'
import { MOVIE } from '../test/factory.ts'
import type { DomainEvent, StoredEvent, Timestamp } from '../types.ts'

/**
 * Horloges croisées — le bornage honnête de « sans conflit » (revue CEO).
 *
 * Le modèle garantit la convergence du STOCKAGE : des faits immuables à
 * identifiants uniques, l'union de deux journaux est le journal, dans
 * n'importe quel ordre. Il ne garantit PAS un arbitrage sémantique
 * indépendant des horloges : le rang des cycles ordonne par `occurred_at`
 * puis `created_at`, c'est-à-dire par les horloges des appareils.
 *
 * Deux appareils hors-ligne sur le même média convergent donc vers le
 * même état — arbitré « dernier écrivain selon l'horloge CLIENT », pas
 * selon le temps réel. Une horloge avancée gagne. C'est accepté pour un
 * usage mono-personne, et ce test le DOCUMENTE : si ce comportement
 * change un jour, ce fichier doit changer avec lui, consciemment.
 */
function event(
  overrides: Partial<StoredEvent> & {
    id: string
    device_id: string
    type: string
    created_at: Timestamp
  },
): DomainEvent {
  return {
    media_ref: MOVIE,
    cycle_key: null,
    occurred_at: overrides.created_at,
    occurred_precision: 'exact',
    ...overrides,
  } as DomainEvent
}

describe('deux appareils hors-ligne, même média, horloges décalées', () => {
  // Appareil B, horloge juste : il regarde et termine le film à 10 h.
  const deviceB: DomainEvent[] = [
    event({ id: 'b-01', device_id: 'device-b', type: 'WATCH', created_at: '2026-03-01T10:00:00.000Z' }),
    event({ id: 'b-02', device_id: 'device-b', type: 'START', cycle_key: 'cycle-b', created_at: '2026-03-01T10:05:00.000Z' }),
    event({ id: 'b-03', device_id: 'device-b', type: 'SEEN', cycle_key: 'cycle-b', created_at: '2026-03-01T10:30:00.000Z' }),
  ]

  // Appareil A, horloge avancée de deux heures : il a REGARDÉ À 9 h en
  // temps réel — avant B — mais ses événements sont datés de 11 h.
  const deviceA: DomainEvent[] = [
    event({ id: 'a-01', device_id: 'device-a', type: 'START', cycle_key: 'cycle-a', created_at: '2026-03-01T11:00:00.000Z' }),
    event({ id: 'a-02', device_id: 'device-a', type: 'DROP', cycle_key: 'cycle-a', created_at: '2026-03-01T11:10:00.000Z' }),
  ]

  it('l’union converge vers le même état, quel que soit l’ordre d’arrivée', () => {
    const ab = mediaState([...deviceA, ...deviceB], MOVIE)
    const ba = mediaState([...deviceB, ...deviceA], MOVIE)

    expect(ab).toEqual(ba)
  })

  it('l’arbitrage suit l’horloge cliente — l’horloge avancée gagne, et c’est documenté', () => {
    const state = mediaState([...deviceA, ...deviceB], MOVIE)

    // En temps réel, B (« vu ») a agi le dernier. Mais le rang des cycles
    // lit les horloges : cycle-a (11 h) > cycle-b (10 h 05), donc l'état
    // affiché est celui de A — « abandonné ». C'est le compromis assumé :
    // pas de vérité d'horloge distribuée pour un produit mono-personne.
    expect(state.status).toBe('dropped')

    // Le visionnage de B n'est pas perdu pour autant : il reste un fait,
    // compté dans ✓ vu ×N. La convergence du stockage est entière.
    expect(state.seenCount).toBe(1)
  })
})
