import { describe, expect, it } from 'vitest'

import { journal } from '@/domain/reducers/journal'
import { createFactory } from '@/domain/test/factory'

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
    const f = createFactory()
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const entries = journal(events)
    const markers = entries.filter((e) => e.kind === 'marqueur')

    expect(markers.map((m) => m.kind === 'marqueur' && m.number)).toEqual([2, 1])
  })

  it('groupe les événements d un cycle sous son marqueur', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.rate('c1', 4, '2019-01-02T20:00:00.000Z'),
      f.seen('c1', '2019-01-02T20:00:00.000Z'),
    ]

    const entries = journal(events)

    expect(entries[0]?.kind).toBe('marqueur')
    expect(entries.filter((e) => e.kind === 'evenement')).toHaveLength(3)
  })

  it('commenter aujourd hui un cycle de 2019 ne le remonte pas', () => {
    const f = createFactory()
    // Le contre-exemple qui avait fait rejeter « positionner le bloc sur le
    // max des occurred_at ». La date de rang ne bouge jamais.
    const events = [
      f.start('ancien', '2019-01-01T20:00:00.000Z'),
      f.start('recent', '2026-01-01T20:00:00.000Z'),
      f.note('ancien', 'toujours aussi bon', '2026-07-27T22:00:00.000Z'),
    ]

    const entries = journal(events)
    const markers = entries.filter((e) => e.kind === 'marqueur')

    // Le cycle 2026 (#2) reste au-dessus du cycle 2019 (#1).
    expect(markers.map((m) => m.kind === 'marqueur' && m.number)).toEqual([2, 1])
  })

  it('place les événements hors cycle à leur position chronologique', () => {
    const f = createFactory()
    const events = [
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.fav('2022-06-01T20:00:00.000Z'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    const entries = journal(events)
    const types = entries.map((e) =>
      e.kind === 'marqueur' ? `#${e.number}` : e.event.type,
    )

    // 2026 en haut, puis le coup de cœur de 2022, puis 2019 en bas.
    expect(types).toEqual(['#2', 'REWATCH', 'FAV', '#1', 'START'])
  })

  it('exclut les événements de progression', () => {
    const f = createFactory()
    // Tout est live : les dates de survenue suivent l'ordre d'appel.
    const events = [f.start('c1'), f.prog('c1', 30), f.prog('c1', 60), f.seen('c1')]

    const types = journal(events)
      .filter((e) => e.kind === 'evenement')
      .map((e) => e.kind === 'evenement' && e.event.type)

    // Personne ne veut relire qu'il a poussé la barre à 30 % un mardi soir.
    expect(types).not.toContain('PROG')
    expect(types).toEqual(['SEEN', 'START'])
  })

  it('exclut les événements annulés', () => {
    const f = createFactory()
    const drop = f.drop('c1')
    const events = [f.start('c1', '2026-01-01T20:00:00.000Z'), drop, f.voided(drop.id)]

    const types = journal(events)
      .filter((e) => e.kind === 'evenement')
      .map((e) => e.kind === 'evenement' && e.event.type)

    expect(types).toEqual(['START'])
  })

  it('place les dates inconnues en fin de liste', () => {
    const f = createFactory()
    const events = [
      f.start('date', '2019-01-01T20:00:00.000Z'),
      f.start('sans-date', null, 'unknown'),
    ]

    const entries = journal(events)
    const markers = entries.filter((e) => e.kind === 'marqueur')

    // Le cycle sans date est le #1 par rang, mais il s'affiche en dernier :
    // on ne peut pas le placer chronologiquement puisqu'on n'a pas sa date.
    expect(markers.map((m) => m.kind === 'marqueur' && m.number)).toEqual([2, 1])
    expect(entries[entries.length - 1]?.kind).toBe('evenement')
  })

  it('conserve les types inconnus en les signalant', () => {
    const f = createFactory()
    const events = [f.start('c1', '2026-01-01T20:00:00.000Z'), f.unknown('LEND')]

    const entries = journal(events)
    const unknown = entries.find(
      (e) => e.kind === 'evenement' && e.event.type === 'LEND',
    )

    // Un trou dans l'historique serait pire qu'une ligne qu'on ne sait pas
    // interpréter : l'UI l'affiche en gris avec son type brut.
    expect(unknown).toBeDefined()
    expect(unknown?.kind === 'evenement' && unknown.known).toBe(false)
  })

  it('départage deux événements de même date par ordre d écriture', () => {
    const f = createFactory()
    // Cas courant du rétro-datage : START et SEEN partagent la date saisie.
    const events = [
      f.start('c1', '2019-05-01T00:00:00.000Z', 'year'),
      f.seen('c1', '2019-05-01T00:00:00.000Z'),
    ]

    const types = journal(events)
      .filter((e) => e.kind === 'evenement')
      .map((e) => e.kind === 'evenement' && e.event.type)

    // Le plus récemment écrit en premier, puisque l'affichage est décroissant.
    expect(types).toEqual(['SEEN', 'START'])
  })

  it('rend une liste vide pour un média sans événement', () => {
    expect(journal([])).toEqual([])
  })
})
