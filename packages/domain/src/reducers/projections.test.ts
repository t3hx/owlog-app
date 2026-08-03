import { describe, expect, it } from 'vitest'

import {
  comment,
  isFavorite,
  seenCount,
  rating,
  progress,
} from './projections.ts'
import { createFactory } from '../test/factory.ts'

describe('nombreDeVisionnages', () => {
  it('compte les cycles termines par SEEN', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2021-01-01T20:00:00.000Z'),
      f.seen('c2'),
    ]

    expect(seenCount(events)).toBe(2)
  })

  it('ne compte pas un cycle en cours', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    expect(seenCount(events)).toBe(1)
  })

  it('ne compte pas un cycle vu PUIS abandonne', () => {
    const f = createFactory()
    // Le mis-tap sur la pastille. Sans cette regle, un titre affiche
    // « ✕ abandonné » avec un compteur de visionnages incrémenté.
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.drop('c1'),
    ]

    expect(seenCount(events)).toBe(0)
  })

  it('recompte le cycle quand le DROP est annulé', () => {
    const f = createFactory()
    const drop = f.drop('c1')
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      drop,
      f.voided(drop.id),
    ]

    expect(seenCount(events)).toBe(1)
  })
})

describe('progression', () => {
  it('rend le dernier PROG du cycle courant', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.prog('c1', 30),
      f.prog('c1', 60),
    ]

    expect(progress(events).percent).toBe(60)
  })

  it('rend 0 quand le statut est a voir', () => {
    const f = createFactory()
    // Apres un bouclage de pastille, le cycle courant reste l'ancien cycle
    // abandonne a 60 %. Un titre « a voir » ne doit pas afficher 60 %.
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.prog('c1', 60),
      f.drop('c1'),
      f.watch(),
    ]

    expect(progress(events).percent).toBe(0)
  })

  it('rend 0 pour un media sans aucun cycle', () => {
    const f = createFactory()
    expect(progress([f.watch()]).percent).toBe(0)
  })

  it('ignore la progression d un cycle qui n est pas le courant', () => {
    const f = createFactory()
    const events = [
      f.start('ancien', '2019-01-01T20:00:00.000Z'),
      f.prog('ancien', 90),
      f.seen('ancien'),
      f.rewatch('courant', '2026-01-01T20:00:00.000Z'),
      f.prog('courant', 10),
    ]

    expect(progress(events).percent).toBe(10)
  })

  it('rend le label et le signale perime quand il precede la progression', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.prog('c1', 60, {
        label: 'S02E05',
        // Anterieur au created_at du PROG, que la fabrique place a
        // 2026-01-01T00:00:0N : le label decrit un episode plus ancien.
        labelCreatedAt: '2025-12-20T10:00:00.000Z',
      }),
    ]

    const result = progress(events)

    expect(result.label).toBe('S02E05')
    // Le label a ete saisi avant l'evenement de progression qui le porte :
    // il decrit un episode plus ancien que l'avancement affiche.
    expect(result.stale).toBe(true)
  })

  it('ne signale pas perime un label pose en meme temps que la progression', () => {
    const f = createFactory()
    const prog = f.prog('c1', 60, { label: 'S02E05' })
    const events = [f.start('c1', '2026-01-01T20:00:00.000Z'), prog]

    expect(progress(events).stale).toBe(false)
  })
})

describe('rating', () => {
  it('rend la derniere note du cycle', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.rate('c1', 3),
      f.rate('c1', 5),
    ]

    expect(rating(events, 'c1')).toBe(5)
  })

  it('rend null quand la note est effacee', () => {
    const f = createFactory()
    // Le re-tap sur la meme etoile.
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.rate('c1', 4),
      f.rate('c1', null),
    ]

    expect(rating(events, 'c1')).toBeNull()
  })

  it('rend null pour un cycle jamais note', () => {
    const f = createFactory()
    expect(rating([f.start('c1', '2026-01-01T20:00:00.000Z')], 'c1')).toBeNull()
  })

  it('garde des notes distinctes par cycle', () => {
    const f = createFactory()
    // C'est la these du produit : la note evolue dans le temps.
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rate('c1', 3),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.rate('c2', 5),
    ]

    expect(rating(events, 'c1')).toBe(3)
    expect(rating(events, 'c2')).toBe(5)
  })
})

describe('commentaire', () => {
  it('rend le dernier commentaire du cycle', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.note('c1', 'premiere impression'),
      f.note('c1', 'finalement mieux que prevu'),
    ]

    expect(comment(events, 'c1')).toBe('finalement mieux que prevu')
  })

  it('rend null pour un cycle sans commentaire', () => {
    const f = createFactory()
    expect(comment([f.start('c1', '2026-01-01T20:00:00.000Z')], 'c1')).toBeNull()
  })
})

describe('estCoupDeCoeur', () => {
  it('est faux par defaut', () => {
    const f = createFactory()
    expect(isFavorite([f.watch()])).toBe(false)
  })

  it('devient vrai apres un FAV', () => {
    const f = createFactory()
    expect(isFavorite([f.watch(), f.fav()])).toBe(true)
  })

  it('redevient faux apres un UNFAV', () => {
    const f = createFactory()
    expect(isFavorite([f.watch(), f.fav(), f.unfav()])).toBe(false)
  })

  it('est cumulable avec n importe quel statut', () => {
    const f = createFactory()
    // Le coup de coeur n'est pas un statut : il ne remplace jamais la
    // pastille, il s'y ajoute.
    const events = [
      f.watch(),
      f.fav(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.drop('c1'),
    ]

    expect(isFavorite(events)).toBe(true)
  })

  it('suit l ordre d ecriture, pas l ordre du tableau', () => {
    const f = createFactory()
    // unfav est ecrit EN PREMIER, fav ensuite : c'est fav qui doit gagner.
    const unfav = f.unfav()
    const fav = f.fav()
    // Le tableau les presente dans l'ordre inverse de l'ecriture.
    expect(isFavorite([fav, unfav])).toBe(true)
  })
})
