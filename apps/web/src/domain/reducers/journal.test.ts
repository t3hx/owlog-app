import { describe, expect, it } from 'vitest'

import { journal } from '@/domain/reducers/journal'
import { creerFabrique } from '@/domain/test/fabrique'

/**
 * Journal d'un média.
 *
 * C'est l'écran qui porte la thèse du produit : le visionnage est l'unité
 * d'enregistrement, et le journal le montre en groupant par cycle plutôt
 * qu'en alignant des lignes plates.
 *
 * Deux règles se croisent ici et peuvent se contredire : les blocs de cycle
 * doivent rester **contigus**, et l'ensemble doit être trié
 * chronologiquement. Quand deux cycles se recouvrent dans le temps, la
 * contiguïté gagne, et le bloc se positionne sur sa **date de rang**.
 */
describe('journal', () => {
  it('rend du plus récent au plus ancien', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const entrees = journal(evenements)
    const marqueurs = entrees.filter((e) => e.genre === 'marqueur')

    expect(marqueurs.map((m) => m.genre === 'marqueur' && m.numero)).toEqual([2, 1])
  })

  it('groupe les événements d un cycle sous son marqueur', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rate('c1', 4, '2019-01-02T20:00:00.000Z'),
      f.seen('c1', '2019-01-02T20:00:00.000Z'),
    ]

    const entrees = journal(evenements)

    expect(entrees[0]?.genre).toBe('marqueur')
    expect(entrees.filter((e) => e.genre === 'evenement')).toHaveLength(3)
  })

  it('commenter aujourd hui un cycle de 2019 ne le remonte pas', () => {
    const f = creerFabrique()
    // Le contre-exemple qui avait fait rejeter « positionner le bloc sur le
    // max des occurred_at ». La date de rang ne bouge jamais.
    const evenements = [
      f.start('ancien', '2019-01-01T20:00:00.000Z'),
      f.start('recent', '2026-01-01T20:00:00.000Z'),
      f.note('ancien', 'toujours aussi bon', '2026-07-27T22:00:00.000Z'),
    ]

    const entrees = journal(evenements)
    const marqueurs = entrees.filter((e) => e.genre === 'marqueur')

    // Le cycle 2026 (#2) reste au-dessus du cycle 2019 (#1).
    expect(marqueurs.map((m) => m.genre === 'marqueur' && m.numero)).toEqual([2, 1])
  })

  it('place les événements hors cycle à leur position chronologique', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.fav('2022-06-01T20:00:00.000Z'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const entrees = journal(evenements)
    const types = entrees.map((e) =>
      e.genre === 'marqueur' ? `#${e.numero}` : e.evenement.type,
    )

    // 2026 en haut, puis le coup de cœur de 2022, puis 2019 en bas.
    expect(types).toEqual(['#2', 'REWATCH', 'FAV', '#1', 'START'])
  })

  it('exclut les événements de progression', () => {
    const f = creerFabrique()
    // Tout est live : les dates de survenue suivent l'ordre d'appel.
    const evenements = [f.start('c1'), f.prog('c1', 30), f.prog('c1', 60), f.seen('c1')]

    const types = journal(evenements)
      .filter((e) => e.genre === 'evenement')
      .map((e) => e.genre === 'evenement' && e.evenement.type)

    // Personne ne veut relire qu'il a poussé la barre à 30 % un mardi soir.
    expect(types).not.toContain('PROG')
    expect(types).toEqual(['SEEN', 'START'])
  })

  it('exclut les événements annulés', () => {
    const f = creerFabrique()
    const drop = f.drop('c1')
    const evenements = [f.start('c1', '2026-01-01T20:00:00.000Z'), drop, f.annule(drop.id)]

    const types = journal(evenements)
      .filter((e) => e.genre === 'evenement')
      .map((e) => e.genre === 'evenement' && e.evenement.type)

    expect(types).toEqual(['START'])
  })

  it('place les dates inconnues en fin de liste', () => {
    const f = creerFabrique()
    const evenements = [
      f.start('date', '2019-01-01T20:00:00.000Z'),
      f.start('sans-date', null, 'inconnu'),
    ]

    const entrees = journal(evenements)
    const marqueurs = entrees.filter((e) => e.genre === 'marqueur')

    // Le cycle sans date est le #1 par rang, mais il s'affiche en dernier :
    // on ne peut pas le placer chronologiquement puisqu'on n'a pas sa date.
    expect(marqueurs.map((m) => m.genre === 'marqueur' && m.numero)).toEqual([2, 1])
    expect(entrees[entrees.length - 1]?.genre).toBe('evenement')
  })

  it('conserve les types inconnus en les signalant', () => {
    const f = creerFabrique()
    const evenements = [f.start('c1', '2026-01-01T20:00:00.000Z'), f.inconnu('LEND')]

    const entrees = journal(evenements)
    const inconnu = entrees.find(
      (e) => e.genre === 'evenement' && e.evenement.type === 'LEND',
    )

    // Un trou dans l'historique serait pire qu'une ligne qu'on ne sait pas
    // interpréter : l'UI l'affiche en gris avec son type brut.
    expect(inconnu).toBeDefined()
    expect(inconnu?.genre === 'evenement' && inconnu.connu).toBe(false)
  })

  it('départage deux événements de même date par ordre d écriture', () => {
    const f = creerFabrique()
    // Cas courant du rétro-datage : START et SEEN partagent la date saisie.
    const evenements = [
      f.start('c1', '2019-05-01T00:00:00.000Z', 'annee'),
      f.seen('c1', '2019-05-01T00:00:00.000Z'),
    ]

    const types = journal(evenements)
      .filter((e) => e.genre === 'evenement')
      .map((e) => e.genre === 'evenement' && e.evenement.type)

    // Le plus récemment écrit en premier, puisque l'affichage est décroissant.
    expect(types).toEqual(['SEEN', 'START'])
  })

  it('rend une liste vide pour un média sans événement', () => {
    expect(journal([])).toEqual([])
  })
})
