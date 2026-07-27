import { describe, expect, it } from 'vitest'

import {
  commentaire,
  estCoupDeCoeur,
  nombreDeVisionnages,
  note,
  progression,
} from '@/domain/reducers/projections'
import { creerFabrique } from '@/domain/test/fabrique'

describe('nombreDeVisionnages', () => {
  it('compte les cycles termines par SEEN', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2021-01-01T20:00:00.000Z'),
      f.seen('c2'),
    ]

    expect(nombreDeVisionnages(evenements)).toBe(2)
  })

  it('ne compte pas un cycle en cours', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    expect(nombreDeVisionnages(evenements)).toBe(1)
  })

  it('ne compte pas un cycle vu PUIS abandonne', () => {
    const f = creerFabrique()
    // Le mis-tap sur la pastille. Sans cette regle, un titre affiche
    // « ✕ abandonné » avec un compteur de visionnages incrémenté.
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.drop('c1'),
    ]

    expect(nombreDeVisionnages(evenements)).toBe(0)
  })

  it('recompte le cycle quand le DROP est annulé', () => {
    const f = creerFabrique()
    const drop = f.drop('c1')
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      drop,
      f.annule(drop.id),
    ]

    expect(nombreDeVisionnages(evenements)).toBe(1)
  })
})

describe('progression', () => {
  it('rend le dernier PROG du cycle courant', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.prog('c1', 30),
      f.prog('c1', 60),
    ]

    expect(progression(evenements).pourcentage).toBe(60)
  })

  it('rend 0 quand le statut est a voir', () => {
    const f = creerFabrique()
    // Apres un bouclage de pastille, le cycle courant reste l'ancien cycle
    // abandonne a 60 %. Un titre « a voir » ne doit pas afficher 60 %.
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.prog('c1', 60),
      f.drop('c1'),
      f.watch(),
    ]

    expect(progression(evenements).pourcentage).toBe(0)
  })

  it('rend 0 pour un media sans aucun cycle', () => {
    const f = creerFabrique()
    expect(progression([f.watch()]).pourcentage).toBe(0)
  })

  it('ignore la progression d un cycle qui n est pas le courant', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('ancien', '2019-01-01T20:00:00.000Z'),
      f.prog('ancien', 90),
      f.seen('ancien'),
      f.rewatch('courant', '2026-01-01T20:00:00.000Z'),
      f.prog('courant', 10),
    ]

    expect(progression(evenements).pourcentage).toBe(10)
  })

  it('rend le label et le signale perime quand il precede la progression', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.prog('c1', 60, {
        label: 'S02E05',
        // Anterieur au created_at du PROG, que la fabrique place a
        // 2026-01-01T00:00:0N : le label decrit un episode plus ancien.
        labelCreatedAt: '2025-12-20T10:00:00.000Z',
      }),
    ]

    const resultat = progression(evenements)

    expect(resultat.label).toBe('S02E05')
    // Le label a ete saisi avant l'evenement de progression qui le porte :
    // il decrit un episode plus ancien que l'avancement affiche.
    expect(resultat.perime).toBe(true)
  })

  it('ne signale pas perime un label pose en meme temps que la progression', () => {
    const f = creerFabrique()
    const prog = f.prog('c1', 60, { label: 'S02E05' })
    const evenements = [f.start('c1', '2026-01-01T20:00:00.000Z'), prog]

    expect(progression(evenements).perime).toBe(false)
  })
})

describe('note', () => {
  it('rend la derniere note du cycle', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.rate('c1', 3),
      f.rate('c1', 5),
    ]

    expect(note(evenements, 'c1')).toBe(5)
  })

  it('rend null quand la note est effacee', () => {
    const f = creerFabrique()
    // Le re-tap sur la meme etoile.
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.rate('c1', 4),
      f.rate('c1', null),
    ]

    expect(note(evenements, 'c1')).toBeNull()
  })

  it('rend null pour un cycle jamais note', () => {
    const f = creerFabrique()
    expect(note([f.start('c1', '2026-01-01T20:00:00.000Z')], 'c1')).toBeNull()
  })

  it('garde des notes distinctes par cycle', () => {
    const f = creerFabrique()
    // C'est la these du produit : la note evolue dans le temps.
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rate('c1', 3),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.rate('c2', 5),
    ]

    expect(note(evenements, 'c1')).toBe(3)
    expect(note(evenements, 'c2')).toBe(5)
  })
})

describe('commentaire', () => {
  it('rend le dernier commentaire du cycle', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.note('c1', 'premiere impression'),
      f.note('c1', 'finalement mieux que prevu'),
    ]

    expect(commentaire(evenements, 'c1')).toBe('finalement mieux que prevu')
  })

  it('rend null pour un cycle sans commentaire', () => {
    const f = creerFabrique()
    expect(commentaire([f.start('c1', '2026-01-01T20:00:00.000Z')], 'c1')).toBeNull()
  })
})

describe('estCoupDeCoeur', () => {
  it('est faux par defaut', () => {
    const f = creerFabrique()
    expect(estCoupDeCoeur([f.watch()])).toBe(false)
  })

  it('devient vrai apres un FAV', () => {
    const f = creerFabrique()
    expect(estCoupDeCoeur([f.watch(), f.fav()])).toBe(true)
  })

  it('redevient faux apres un UNFAV', () => {
    const f = creerFabrique()
    expect(estCoupDeCoeur([f.watch(), f.fav(), f.unfav()])).toBe(false)
  })

  it('est cumulable avec n importe quel statut', () => {
    const f = creerFabrique()
    // Le coup de coeur n'est pas un statut : il ne remplace jamais la
    // pastille, il s'y ajoute.
    const evenements = [
      f.watch(),
      f.fav(),
      f.start('c1', '2026-01-01T20:00:00.000Z'),
      f.drop('c1'),
    ]

    expect(estCoupDeCoeur(evenements)).toBe(true)
  })

  it('suit l ordre d ecriture, pas l ordre du tableau', () => {
    const f = creerFabrique()
    // unfav est ecrit EN PREMIER, fav ensuite : c'est fav qui doit gagner.
    const unfav = f.unfav()
    const fav = f.fav()
    // Le tableau les presente dans l'ordre inverse de l'ecriture.
    expect(estCoupDeCoeur([fav, unfav])).toBe(true)
  })
})
