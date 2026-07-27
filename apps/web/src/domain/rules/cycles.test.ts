import { describe, expect, it } from 'vitest'

import { cycles } from '@/domain/rules/cycles'
import { creerFabrique } from '@/domain/test/fabrique'

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
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-05-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const resultat = cycles(evenements)

    expect(resultat).toHaveLength(2)
    expect(resultat[0]?.evenements).toHaveLength(2)
    expect(resultat[1]?.evenements).toHaveLength(1)
  })

  it('ordonne par date de rang, pas par ordre d écriture', () => {
    const f = creerFabrique()
    // Le cycle de 2026 est écrit EN PREMIER, celui de 2019 ensuite.
    const evenements = [
      f.start('recent', '2026-01-01T20:00:00.000Z'),
      f.start('ancien', '2019-05-01T20:00:00.000Z'),
    ]

    const resultat = cycles(evenements)

    expect(resultat.map((c) => c.key)).toEqual(['ancien', 'recent'])
  })

  it('numérote #N par rang chronologique, quel que soit l ordre de saisie', () => {
    const f = creerFabrique()
    // Trois visionnages saisis à rebours, cas réel de la saisie de masse.
    const evenements = [
      f.start('troisieme', '2024-01-01T20:00:00.000Z'),
      f.start('deuxieme', '2021-01-01T20:00:00.000Z'),
      f.start('premier', '2019-01-01T20:00:00.000Z'),
    ]

    const resultat = cycles(evenements)

    expect(resultat.map((c) => [c.key, c.rang])).toEqual([
      ['premier', 1],
      ['deuxieme', 2],
      ['troisieme', 3],
    ])
  })

  it('départage deux dates de rang identiques par created_at', () => {
    const f = creerFabrique()
    // Deux titres rétro-datés à l'année : même occurred_at, à la seconde près.
    const evenements = [
      f.start('ecrit-en-premier', '2019-01-01T00:00:00.000Z', 'annee'),
      f.start('ecrit-ensuite', '2019-01-01T00:00:00.000Z', 'annee'),
    ]

    const resultat = cycles(evenements)

    expect(resultat.map((c) => c.key)).toEqual(['ecrit-en-premier', 'ecrit-ensuite'])
  })

  it('classe les cycles sans date avant tous les autres', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('date', '2019-01-01T20:00:00.000Z'),
      f.start('sans-date', null, 'inconnu'),
    ]

    const resultat = cycles(evenements)

    expect(resultat.map((c) => c.key)).toEqual(['sans-date', 'date'])
    expect(resultat[0]?.dateDeRang).toBeNull()
  })

  it('prend l événement d ouverture comme date de rang, pas le plus récent', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-05-01T20:00:00.000Z'),
      // Un commentaire écrit aujourd'hui sur un visionnage de 2019. Il ne
      // doit pas faire remonter le cycle : la date d'ouverture est la seule
      // qui ne bouge jamais.
      f.note('c1', 'toujours aussi bon', '2026-07-27T22:00:00.000Z'),
      f.start('c2', '2020-01-01T20:00:00.000Z'),
    ]

    const resultat = cycles(evenements)

    expect(resultat.map((c) => c.key)).toEqual(['c1', 'c2'])
    expect(resultat[0]?.dateDeRang).toBe('2019-05-01T20:00:00.000Z')
  })

  it('tolère un cycle sans événement d ouverture', () => {
    const f = creerFabrique()
    // Cas qui ne peut venir que d'une synchronisation partielle : les
    // événements du cycle sont là, son ouverture non. On ne perd pas la
    // donnée pour autant.
    const evenements = [f.seen('orphelin', '2019-05-01T20:00:00.000Z')]

    const resultat = cycles(evenements)

    expect(resultat).toHaveLength(1)
    expect(resultat[0]?.key).toBe('orphelin')
    expect(resultat[0]?.ouvertureManquante).toBe(true)
  })

  it('ignore les événements hors cycle', () => {
    const f = creerFabrique()
    const evenements = [f.watch(), f.fav(), f.start('c1', '2019-01-01T20:00:00.000Z')]

    const resultat = cycles(evenements)

    expect(resultat).toHaveLength(1)
    expect(resultat[0]?.evenements).toHaveLength(1)
  })

  it('ignore les types inconnus', () => {
    const f = creerFabrique()
    const evenements = [f.start('c1', '2019-01-01T20:00:00.000Z'), f.inconnu('LEND')]

    const resultat = cycles(evenements)

    expect(resultat).toHaveLength(1)
  })

  it('classe un cycle ouvert par REWATCH comme n importe quel autre', () => {
    const f = creerFabrique()
    const evenements = [
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
    ]

    const resultat = cycles(evenements)

    expect(resultat.map((c) => c.rang)).toEqual([1, 2])
    expect(resultat[1]?.key).toBe('c2')
  })
})

describe('cycles — état terminal', () => {
  it('reconnaît un cycle termine par SEEN', () => {
    const f = creerFabrique()
    const resultat = cycles([f.start('c1', '2019-01-01T20:00:00.000Z'), f.seen('c1')])

    expect(resultat[0]?.aSeen).toBe(true)
    expect(resultat[0]?.aDrop).toBe(false)
  })

  it('reconnaît un cycle abandonné', () => {
    const f = creerFabrique()
    const resultat = cycles([f.start('c1', '2019-01-01T20:00:00.000Z'), f.drop('c1')])

    expect(resultat[0]?.aDrop).toBe(true)
  })

  it('reconnaît un cycle vu PUIS abandonné', () => {
    const f = creerFabrique()
    // Le mis-tap sur la pastille : un DROP atterrit sur un cycle qui porte
    // déjà son SEEN. Les deux drapeaux sont vrais, et c'est ce qui permet
    // à seenCount de ne pas le compter.
    const resultat = cycles([
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.drop('c1'),
    ])

    expect(resultat[0]?.aSeen).toBe(true)
    expect(resultat[0]?.aDrop).toBe(true)
  })
})
