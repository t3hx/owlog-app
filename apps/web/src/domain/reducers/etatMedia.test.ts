import { describe, expect, it } from 'vitest'

import { compteursAccueil, etatMedia, bibliotheque } from '@/domain/reducers/etatMedia'
import { creerFabrique, FILM, SERIE } from '@/domain/test/fabrique'

/**
 * Modèle de lecture.
 *
 * `etatMedia` est **l'unique producteur** de la table `media_state`. Cette
 * table est dérivée : jamais une source de vérité, reconstructible
 * intégralement depuis les événements.
 *
 * La page média et la bibliothèque la lisent toutes les deux. Sans ce
 * chemin unique, le statut se calculerait par deux voies — direct sur la
 * fiche, dérivé dans la liste — et le jour où elles divergent, la
 * bibliothèque afficherait `● en cours` face à un `✓ vu` sur la fiche.
 */
describe('etatMedia', () => {
  it('rend une ligne complete pour un titre en cours', () => {
    const f = creerFabrique()
    const evenements = [f.watch(), f.start('c1'), f.prog('c1', 40, { label: 'S02E05' })]

    const etat = etatMedia(evenements, FILM)

    expect(etat).toMatchObject({
      ref: FILM,
      statut: 'en-cours',
      pourcentage: 40,
      label: 'S02E05',
      nombreDeVisionnages: 0,
      coupDeCoeur: false,
      cycleCourant: 'c1',
    })
  })

  it('remonte la note du cycle courant, pas celle d un cycle passe', () => {
    const f = creerFabrique()
    const evenements = [
      f.watch(),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rate('c1', 3),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.rate('c2', 5),
    ]

    // C'est la these du produit : la note evolue dans le temps, et la fiche
    // montre celle du visionnage en cours.
    expect(etatMedia(evenements, FILM).note).toBe(5)
  })

  it('compte les visionnages aboutis', () => {
    const f = creerFabrique()
    const evenements = [
      f.watch(),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.seen('c2'),
    ]

    expect(etatMedia(evenements, FILM).nombreDeVisionnages).toBe(2)
  })

  it('rend un etat absent quand le media a ete retire', () => {
    const f = creerFabrique()
    expect(etatMedia([f.watch(), f.remove()], FILM).statut).toBe('absent')
  })

  it('horodate la ligne avec le dernier evenement ecrit', () => {
    const f = creerFabrique()
    // L'ordre de construction fait foi : la fabrique horodate a l'appel.
    const watch = f.watch()
    const dernier = f.start('c1')
    const etat = etatMedia([watch, dernier], FILM)

    expect(etat.majLe).toBe(dernier.created_at)
  })

  it('est identique quel que soit l ordre du tableau d entree', () => {
    const f = creerFabrique()
    const watch = f.watch()
    const start = f.start('c1')
    const seen = f.seen('c1')

    // La reconstruction integrale rejoue les evenements dans l'ordre du
    // store ; l'etat accumule doit etre le meme.
    expect(etatMedia([watch, start, seen], FILM)).toEqual(
      etatMedia([seen, watch, start], FILM),
    )
  })
})

describe('bibliotheque', () => {
  it('exclut les medias absents', () => {
    const f1 = creerFabrique(FILM)
    const f2 = creerFabrique(SERIE)

    const etats = [
      etatMedia([f1.watch()], FILM),
      etatMedia([f2.watch(), f2.remove()], SERIE),
    ]

    expect(bibliotheque(etats).lignes.map((l) => l.ref)).toEqual([FILM])
  })

  it('compte les chips par statut', () => {
    const f1 = creerFabrique(FILM)
    const f2 = creerFabrique(SERIE)

    const etats = [
      etatMedia([f1.watch()], FILM),
      etatMedia([f2.watch(), f2.start('c1')], SERIE),
    ]

    const { compteurs } = bibliotheque(etats)

    expect(compteurs).toMatchObject({
      tous: 2,
      'a-voir': 1,
      'en-cours': 1,
      vu: 0,
      abandonne: 0,
      coupsDeCoeur: 0,
    })
  })

  it('compte les coups de coeur quel que soit leur statut', () => {
    const f1 = creerFabrique(FILM)
    const f2 = creerFabrique(SERIE)

    const etats = [
      etatMedia([f1.watch(), f1.fav()], FILM),
      etatMedia([f2.watch(), f2.start('c1'), f2.drop('c1'), f2.fav()], SERIE),
    ]

    // Le coup de coeur n'est pas un statut : il se cumule avec les quatre.
    expect(bibliotheque(etats).compteurs.coupsDeCoeur).toBe(2)
  })
})

describe('compteursAccueil', () => {
  it('compte les en cours et les a voir', () => {
    const f1 = creerFabrique(FILM)
    const f2 = creerFabrique(SERIE)

    const etats = [
      etatMedia([f1.watch()], FILM),
      etatMedia([f2.watch(), f2.start('c1')], SERIE),
    ]

    expect(compteursAccueil(etats)).toEqual({ enCours: 1, aVoir: 1 })
  })

  it('ignore les medias retires', () => {
    const f = creerFabrique()
    expect(compteursAccueil([etatMedia([f.watch(), f.remove()], FILM)])).toEqual({
      enCours: 0,
      aVoir: 0,
    })
  })
})
