import { describe, expect, it } from 'vitest'

import { currentStatus } from '@/domain/rules/status'
import { createFactory } from '@/domain/test/factory'

/**
 * Règle centrale : dérivation du statut.
 *
 * Une formulation naïve produit le mauvais résultat, et ce test l'empêche
 * de revenir. `SEEN` est un événement de statut : un `SEEN` rétro-daté
 * saisi aujourd'hui porte le `created_at` le plus récent, donc un tri par
 * `created_at` ferait basculer à tort en `vu` un titre en cours de
 * visionnage.
 *
 * La règle correcte lit le cycle de **rang** le plus élevé, pas le
 * `created_at` le plus récent.
 */
describe('statutCourant — cycle de la pastille', () => {
  it('rend absent pour un média sans aucun événement', () => {
    expect(currentStatus([])).toBe('absent')
  })

  it('rend à voir après un WATCH', () => {
    const f = createFactory()
    expect(currentStatus([f.watch()])).toBe('to-watch')
  })

  it('rend en cours après un START', () => {
    const f = createFactory()
    expect(currentStatus([f.watch(), f.start('c1', '2026-01-01T20:00:00.000Z')])).toBe(
      'watching',
    )
  })

  it('rend vu après un SEEN', () => {
    const f = createFactory()
    expect(
      currentStatus([f.watch(), f.start('c1', '2026-01-01T20:00:00.000Z'), f.seen('c1')]),
    ).toBe('seen')
  })

  it('rend abandonné après un DROP', () => {
    const f = createFactory()
    expect(
      currentStatus([f.watch(), f.start('c1', '2026-01-01T20:00:00.000Z'), f.drop('c1')]),
    ).toBe('dropped')
  })

  it('reboucle vers à voir après un WATCH hors cycle', () => {
    const f = createFactory()
    // Le quatrième tap sur la pastille : depuis « abandonné », on revient à
    // « à voir » sans ouvrir de cycle.
    const events = [
      f.watch(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.drop('c1'),
      f.watch(),
    ]

    expect(currentStatus(events)).toBe('to-watch')
  })

  it('donne priorité à DROP sur SEEN dans un même cycle', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.drop('c1'),
    ]

    expect(currentStatus(events)).toBe('dropped')
  })
})

describe('statutCourant — rétro-datage, le piège', () => {
  it('un SEEN rétro-daté en 2019 ne change pas un titre en cours depuis 2026', () => {
    const f = createFactory()
    // Cas 1 du plan. Le cycle de 2019 est écrit EN DERNIER, donc il porte le
    // created_at le plus récent. Trié par created_at → « vu », ce qui est
    // FAUX. Trié par rang → le cycle de 2026 reste courant.
    const events = [
      f.watch(),
      f.start('watching', '2026-01-01T20:00:00.000Z'),
      f.start('souvenir', '2019-05-01T20:00:00.000Z'),
      f.seen('souvenir', '2019-05-01T22:00:00.000Z'),
    ]

    expect(currentStatus(events)).toBe('watching')
  })

  it('un SEEN sur le cycle courant le clôt', () => {
    const f = createFactory()
    // Cas 2 du plan : « en fait je l'ai fini la semaine dernière ». La
    // commande rattache le SEEN au cycle ouvert plutôt que d'en minter un
    // second ; du point de vue du réducteur, le cycle courant est clos.
    const events = [
      f.watch(),
      f.start('watching', '2026-01-01T20:00:00.000Z'),
      f.seen('watching', '2026-07-20T20:00:00.000Z'),
    ]

    expect(currentStatus(events)).toBe('seen')
  })

  it('un cycle rétro-daté POSTÉRIEUR au cycle en cours devient le courant', () => {
    const f = createFactory()
    // Si aucun cycle ouvert ne précède la date saisie, un cycle neuf est
    // minté ; son rang est le plus élevé, donc il porte le statut.
    const events = [
      f.start('ancien', '2019-01-01T20:00:00.000Z'),
      f.seen('ancien', '2019-01-02T20:00:00.000Z'),
      f.start('recent', '2026-01-01T20:00:00.000Z'),
      f.seen('recent', '2026-01-02T20:00:00.000Z'),
    ]

    expect(currentStatus(events)).toBe('seen')
  })

  it('un cycle sans date ne prend jamais le pas sur un cycle daté', () => {
    const f = createFactory()
    const events = [
      f.start('watching', '2026-01-01T20:00:00.000Z'),
      f.start('je-ne-sais-plus', null, 'unknown'),
      f.seen('je-ne-sais-plus', null),
    ]

    // Les cycles sans date sont classés avant tous les autres, donc celui
    // de 2026 reste courant.
    expect(currentStatus(events)).toBe('watching')
  })
})

describe('statutCourant — présence en bibliothèque', () => {
  it('rend absent après un REMOVE', () => {
    const f = createFactory()
    expect(currentStatus([f.watch(), f.remove()])).toBe('absent')
  })

  it('réapparaît avec ses cycles après un WATCH suivant un REMOVE', () => {
    const f = createFactory()
    const events = [
      f.watch(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.remove(),
      f.watch(),
    ]

    // Le WATCH est postérieur à tout le cycle courant : la pastille revient
    // à « à voir », et l'historique du cycle est intact — c'est la
    // consequence assumee de l'append-only.
    expect(currentStatus(events)).toBe('to-watch')
  })

  it('un REMOVE annulé ne retire plus le média', () => {
    const f = createFactory()
    const remove = f.remove()
    const events = [f.watch(), remove, f.voided(remove.id)]

    expect(currentStatus(events)).toBe('to-watch')
  })

  it('un DROP annulé rend son statut au cycle', () => {
    const f = createFactory()
    const drop = f.drop('c1')
    const events = [
      f.watch(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.seen('c1'),
      drop,
      f.voided(drop.id),
    ]

    expect(currentStatus(events)).toBe('seen')
  })
})

describe('statutCourant — tolérance', () => {
  it('rend à voir pour un média sans cycle mais avec un coup de cœur', () => {
    const f = createFactory()
    expect(currentStatus([f.watch(), f.fav()])).toBe('to-watch')
  })

  it('ignore les types inconnus sans lever', () => {
    const f = createFactory()
    const events = [f.watch(), f.unknown('LEND'), f.start('c1', '2026-01-01T20:00:00.000Z')]

    expect(() => currentStatus(events)).not.toThrow()
    expect(currentStatus(events)).toBe('watching')
  })
})
