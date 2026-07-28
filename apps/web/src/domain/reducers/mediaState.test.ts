import { describe, expect, it } from 'vitest'

import { homeCounters, mediaState, library } from '@/domain/reducers/mediaState'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'

/**
 * Modèle de lecture.
 *
 * `mediaState` est **l'unique producteur** de la table `media_state`. Cette
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
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.prog('c1', 40, { label: 'S02E05' })]

    const etat = mediaState(events, MOVIE)

    expect(etat).toMatchObject({
      ref: MOVIE,
      status: 'watching',
      percent: 40,
      label: 'S02E05',
      seenCount: 0,
      favorite: false,
      currentCycle: 'c1',
    })
  })

  it('remonte la note du cycle courant, pas celle d un cycle passe', () => {
    const f = createFactory()
    const events = [
      f.watch(),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rate('c1', 3),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.rate('c2', 5),
    ]

    // C'est la these du produit : la note evolue dans le temps, et la fiche
    // montre celle du visionnage en cours.
    expect(mediaState(events, MOVIE).note).toBe(5)
  })

  it('compte les visionnages aboutis', () => {
    const f = createFactory()
    const events = [
      f.watch(),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
      f.seen('c2'),
    ]

    expect(mediaState(events, MOVIE).seenCount).toBe(2)
  })

  it('rend un etat absent quand le media a ete retire', () => {
    const f = createFactory()
    expect(mediaState([f.watch(), f.remove()], MOVIE).status).toBe('absent')
  })

  it('horodate la ligne avec le dernier evenement ecrit', () => {
    const f = createFactory()
    // L'ordre de construction fait foi : la fabrique horodate a l'appel.
    const watch = f.watch()
    const last = f.start('c1')
    const etat = mediaState([watch, last], MOVIE)

    expect(etat.updatedAt).toBe(last.created_at)
  })

  it('est identique quel que soit l ordre du tableau d entree', () => {
    const f = createFactory()
    const watch = f.watch()
    const start = f.start('c1')
    const seen = f.seen('c1')

    // La reconstruction integrale rejoue les evenements dans l'ordre du
    // store ; l'etat accumule doit etre le meme.
    expect(mediaState([watch, start, seen], MOVIE)).toEqual(
      mediaState([seen, watch, start], MOVIE),
    )
  })
})

describe('bibliotheque', () => {
  it('exclut les medias absents', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    const states = [
      mediaState([f1.watch()], MOVIE),
      mediaState([f2.watch(), f2.remove()], SERIES),
    ]

    expect(library(states).rows.map((l) => l.ref)).toEqual([MOVIE])
  })

  it('compte les chips par statut', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    const states = [
      mediaState([f1.watch()], MOVIE),
      mediaState([f2.watch(), f2.start('c1')], SERIES),
    ]

    const { counts } = library(states)

    expect(counts).toMatchObject({
      all: 2,
      'to-watch': 1,
      'watching': 1,
      seen: 0,
      dropped: 0,
      favorites: 0,
    })
  })

  it('compte les coups de coeur quel que soit leur statut', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    const states = [
      mediaState([f1.watch(), f1.fav()], MOVIE),
      mediaState([f2.watch(), f2.start('c1'), f2.drop('c1'), f2.fav()], SERIES),
    ]

    // Le coup de coeur n'est pas un statut : il se cumule avec les quatre.
    expect(library(states).counts.favorites).toBe(2)
  })
})

describe('compteursAccueil', () => {
  it('compte les en cours et les a voir', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    const states = [
      mediaState([f1.watch()], MOVIE),
      mediaState([f2.watch(), f2.start('c1')], SERIES),
    ]

    expect(homeCounters(states)).toEqual({ enCours: 1, aVoir: 1 })
  })

  it('ignore les medias retires', () => {
    const f = createFactory()
    expect(homeCounters([mediaState([f.watch(), f.remove()], MOVIE)])).toEqual({
      enCours: 0,
      aVoir: 0,
    })
  })
})
