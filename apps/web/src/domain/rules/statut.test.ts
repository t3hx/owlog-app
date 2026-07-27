import { describe, expect, it } from 'vitest'

import { statutCourant } from '@/domain/rules/statut'
import { creerFabrique } from '@/domain/test/fabrique'

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
    expect(statutCourant([])).toBe('absent')
  })

  it('rend à voir après un WATCH', () => {
    const f = creerFabrique()
    expect(statutCourant([f.watch()])).toBe('a-voir')
  })

  it('rend en cours après un START', () => {
    const f = creerFabrique()
    expect(statutCourant([f.watch(), f.start('c1', '2026-01-01T20:00:00.000Z')])).toBe(
      'en-cours',
    )
  })

  it('rend vu après un SEEN', () => {
    const f = creerFabrique()
    expect(
      statutCourant([f.watch(), f.start('c1', '2026-01-01T20:00:00.000Z'), f.seen('c1')]),
    ).toBe('vu')
  })

  it('rend abandonné après un DROP', () => {
    const f = creerFabrique()
    expect(
      statutCourant([f.watch(), f.start('c1', '2026-01-01T20:00:00.000Z'), f.drop('c1')]),
    ).toBe('abandonne')
  })

  it('reboucle vers à voir après un WATCH hors cycle', () => {
    const f = creerFabrique()
    // Le quatrième tap sur la pastille : depuis « abandonné », on revient à
    // « à voir » sans ouvrir de cycle.
    const evenements = [
      f.watch(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.drop('c1'),
      f.watch(),
    ]

    expect(statutCourant(evenements)).toBe('a-voir')
  })

  it('donne priorité à DROP sur SEEN dans un même cycle', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.drop('c1'),
    ]

    expect(statutCourant(evenements)).toBe('abandonne')
  })
})

describe('statutCourant — rétro-datage, le piège', () => {
  it('un SEEN rétro-daté en 2019 ne change pas un titre en cours depuis 2026', () => {
    const f = creerFabrique()
    // Cas 1 du plan. Le cycle de 2019 est écrit EN DERNIER, donc il porte le
    // created_at le plus récent. Trié par created_at → « vu », ce qui est
    // FAUX. Trié par rang → le cycle de 2026 reste courant.
    const evenements = [
      f.watch(),
      f.start('en-cours', '2026-01-01T20:00:00.000Z'),
      f.start('souvenir', '2019-05-01T20:00:00.000Z'),
      f.seen('souvenir', '2019-05-01T22:00:00.000Z'),
    ]

    expect(statutCourant(evenements)).toBe('en-cours')
  })

  it('un SEEN sur le cycle courant le clôt', () => {
    const f = creerFabrique()
    // Cas 2 du plan : « en fait je l'ai fini la semaine dernière ». La
    // commande rattache le SEEN au cycle ouvert plutôt que d'en minter un
    // second ; du point de vue du réducteur, le cycle courant est clos.
    const evenements = [
      f.watch(),
      f.start('en-cours', '2026-01-01T20:00:00.000Z'),
      f.seen('en-cours', '2026-07-20T20:00:00.000Z'),
    ]

    expect(statutCourant(evenements)).toBe('vu')
  })

  it('un cycle rétro-daté POSTÉRIEUR au cycle en cours devient le courant', () => {
    const f = creerFabrique()
    // Si aucun cycle ouvert ne précède la date saisie, un cycle neuf est
    // minté ; son rang est le plus élevé, donc il porte le statut.
    const evenements = [
      f.start('ancien', '2019-01-01T20:00:00.000Z'),
      f.seen('ancien', '2019-01-02T20:00:00.000Z'),
      f.start('recent', '2026-01-01T20:00:00.000Z'),
      f.seen('recent', '2026-01-02T20:00:00.000Z'),
    ]

    expect(statutCourant(evenements)).toBe('vu')
  })

  it('un cycle sans date ne prend jamais le pas sur un cycle daté', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('en-cours', '2026-01-01T20:00:00.000Z'),
      f.start('je-ne-sais-plus', null, 'inconnu'),
      f.seen('je-ne-sais-plus', null),
    ]

    // Les cycles sans date sont classés avant tous les autres, donc celui
    // de 2026 reste courant.
    expect(statutCourant(evenements)).toBe('en-cours')
  })
})

describe('statutCourant — présence en bibliothèque', () => {
  it('rend absent après un REMOVE', () => {
    const f = creerFabrique()
    expect(statutCourant([f.watch(), f.remove()])).toBe('absent')
  })

  it('réapparaît avec ses cycles après un WATCH suivant un REMOVE', () => {
    const f = creerFabrique()
    const evenements = [
      f.watch(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.remove(),
      f.watch(),
    ]

    // Le WATCH est postérieur à tout le cycle courant : la pastille revient
    // à « à voir », et l'historique du cycle est intact — c'est la
    // consequence assumee de l'append-only.
    expect(statutCourant(evenements)).toBe('a-voir')
  })

  it('un REMOVE annulé ne retire plus le média', () => {
    const f = creerFabrique()
    const remove = f.remove()
    const evenements = [f.watch(), remove, f.annule(remove.id)]

    expect(statutCourant(evenements)).toBe('a-voir')
  })

  it('un DROP annulé rend son statut au cycle', () => {
    const f = creerFabrique()
    const drop = f.drop('c1')
    const evenements = [
      f.watch(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.seen('c1'),
      drop,
      f.annule(drop.id),
    ]

    expect(statutCourant(evenements)).toBe('vu')
  })
})

describe('statutCourant — tolérance', () => {
  it('rend à voir pour un média sans cycle mais avec un coup de cœur', () => {
    const f = creerFabrique()
    expect(statutCourant([f.watch(), f.fav()])).toBe('a-voir')
  })

  it('ignore les types inconnus sans lever', () => {
    const f = creerFabrique()
    const evenements = [f.watch(), f.inconnu('LEND'), f.start('c1', '2026-01-01T20:00:00.000Z')]

    expect(() => statutCourant(evenements)).not.toThrow()
    expect(statutCourant(evenements)).toBe('en-cours')
  })
})
