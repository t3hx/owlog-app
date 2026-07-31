import { describe, expect, it } from 'vitest'

import { cycles } from './cycles.ts'
import { createFactory } from '../test/factory.ts'

/**
 * Rang des cycles.
 *
 * C'est la règle la plus load-bearing du modèle : la numérotation `#N`, la
 * dérivation du statut et le tri du journal en dépendent tous les trois.
 * Une définition floue ici produirait trois comportements incohérents dans
 * trois écrans différents, diagnostiqués comme trois bugs distincts.
 *
 * Une seule définition : **la date de rang d'un cycle est l'`occurred_at`
 * de son événement d'ouverture** (`START` ou `REWATCH`).
 */
describe('cycles — rang et numérotation', () => {
  it('groupe les événements par cycle_key', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2019-05-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const result = cycles(events)

    expect(result).toHaveLength(2)
    expect(result[0]?.events).toHaveLength(2)
    expect(result[1]?.events).toHaveLength(1)
  })

  it('ordonne par date de rang, pas par ordre d écriture', () => {
    const f = createFactory()
    // Le cycle de 2026 est écrit EN PREMIER, celui de 2019 ensuite.
    const events = [
      f.start('recent', '2026-01-01T20:00:00.000Z'),
      f.start('ancien', '2019-05-01T20:00:00.000Z'),
    ]

    const result = cycles(events)

    expect(result.map((c) => c.key)).toEqual(['ancien', 'recent'])
  })

  it('numérote #N par rang chronologique, quel que soit l ordre de saisie', () => {
    const f = createFactory()
    // Trois visionnages saisis à rebours, cas réel de la saisie de masse.
    const events = [
      f.start('troisieme', '2024-01-01T20:00:00.000Z'),
      f.start('deuxieme', '2021-01-01T20:00:00.000Z'),
      f.start('first', '2019-01-01T20:00:00.000Z'),
    ]

    const result = cycles(events)

    expect(result.map((c) => [c.key, c.rank])).toEqual([
      ['first', 1],
      ['deuxieme', 2],
      ['troisieme', 3],
    ])
  })

  it('départage deux dates de rang identiques par created_at', () => {
    const f = createFactory()
    // Deux titres rétro-datés à l'année : même occurred_at, à la seconde près.
    const events = [
      f.start('written-first', '2019-01-01T00:00:00.000Z', 'year'),
      f.start('written-next', '2019-01-01T00:00:00.000Z', 'year'),
    ]

    const result = cycles(events)

    expect(result.map((c) => c.key)).toEqual(['written-first', 'written-next'])
  })

  it('classe les cycles sans date avant tous les autres', () => {
    const f = createFactory()
    const events = [
      f.start('date', '2019-01-01T20:00:00.000Z'),
      f.start('sans-date', null, 'unknown'),
    ]

    const result = cycles(events)

    expect(result.map((c) => c.key)).toEqual(['sans-date', 'date'])
    expect(result[0]?.rankDate).toBeNull()
  })

  it('prend l événement d ouverture comme date de rang, pas le plus récent', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2019-05-01T20:00:00.000Z'),
      // Un commentaire écrit aujourd'hui sur un visionnage de 2019. Il ne
      // doit pas faire remonter le cycle : la date d'ouverture est la seule
      // qui ne bouge jamais.
      f.note('c1', 'toujours aussi bon', '2026-07-27T22:00:00.000Z'),
      f.start('c2', '2020-01-01T20:00:00.000Z'),
    ]

    const result = cycles(events)

    expect(result.map((c) => c.key)).toEqual(['c1', 'c2'])
    expect(result[0]?.rankDate).toBe('2019-05-01T20:00:00.000Z')
  })

  it('tolère un cycle sans événement d ouverture', () => {
    const f = createFactory()
    // Cas qui ne peut venir que d'une synchronisation partielle : les
    // événements du cycle sont là, son ouverture non. On ne perd pas la
    // donnée pour autant.
    const events = [f.seen('orphelin', '2019-05-01T20:00:00.000Z')]

    const result = cycles(events)

    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('orphelin')
    expect(result[0]?.missingOpening).toBe(true)
  })

  it('ignore les événements hors cycle', () => {
    const f = createFactory()
    const events = [f.watch(), f.fav(), f.start('c1', '2019-01-01T20:00:00.000Z')]

    const result = cycles(events)

    expect(result).toHaveLength(1)
    expect(result[0]?.events).toHaveLength(1)
  })

  it('ignore les types inconnus', () => {
    const f = createFactory()
    const events = [f.start('c1', '2019-01-01T20:00:00.000Z'), f.unknown('LEND')]

    const result = cycles(events)

    expect(result).toHaveLength(1)
  })

  it('classe un cycle ouvert par REWATCH comme n importe quel autre', () => {
    const f = createFactory()
    const events = [
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
    ]

    const result = cycles(events)

    expect(result.map((c) => c.rank)).toEqual([1, 2])
    expect(result[1]?.key).toBe('c2')
  })
})

describe('cycles — état terminal', () => {
  it('reconnaît un cycle termine par SEEN', () => {
    const f = createFactory()
    const result = cycles([f.start('c1', '2019-01-01T20:00:00.000Z'), f.seen('c1')])

    expect(result[0]?.hasSeen).toBe(true)
    expect(result[0]?.hasDrop).toBe(false)
  })

  it('reconnaît un cycle abandonné', () => {
    const f = createFactory()
    const result = cycles([f.start('c1', '2019-01-01T20:00:00.000Z'), f.drop('c1')])

    expect(result[0]?.hasDrop).toBe(true)
  })

  it('reconnaît un cycle vu PUIS abandonné', () => {
    const f = createFactory()
    // Le mis-tap sur la pastille : un DROP atterrit sur un cycle qui porte
    // déjà son SEEN. Les deux drapeaux sont vrais, et c'est ce qui permet
    // à seenCount de ne pas le compter.
    const result = cycles([
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.drop('c1'),
    ])

    expect(result[0]?.hasSeen).toBe(true)
    expect(result[0]?.hasDrop).toBe(true)
  })
})
