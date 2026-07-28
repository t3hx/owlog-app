import { describe, expect, it } from 'vitest'

import { entriesPerDay, metrics } from '@/domain/reducers/metrics'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'
import type { MediaRef, StoredEvent } from '@/domain/types'

function byMedia(
  entries: readonly { ref: MediaRef; events: readonly StoredEvent[] }[],
): ReadonlyMap<MediaRef, readonly StoredEvent[]> {
  return new Map(entries.map((entry) => [entry.ref, entry.events]))
}

/**
 * Métriques de diagnostic.
 *
 * Elles ne servent aucun écran du produit : elles répondent aux questions
 * qu'on se pose sur les données elles-mêmes. `cyclesBeyondFirst` dit si le
 * moment fort du produit a jamais été déclenché ; `unknownEvents` est le
 * seul endroit où l'on découvre qu'une version du client a déposé des
 * données qu'une autre ne lit pas.
 */
describe('metriques', () => {
  it('compte les visionnages au-dela du premier', () => {
    const f = createFactory(MOVIE)
    const events = [
      f.watch(),
      f.start('c1', '2019-01-01T20:00:00.000Z'),
      f.seen('c1', '2019-01-01T20:00:00.000Z'),
      f.rewatch('c2', '2026-01-01T20:00:00.000Z'),
    ]

    // Si ce compteur reste a zero apres deux semaines d'usage, le produit
    // livre n'est qu'une watchlist de plus.
    expect(metrics(byMedia([{ ref: MOVIE, events }])).cyclesBeyondFirst).toBe(1)
  })

  it('signale les types qu aucun reducteur ne lit', () => {
    const f = createFactory(MOVIE)
    const events = [f.watch(), f.unknown('LEND'), f.unknown('LEND')]

    const measured = metrics(byMedia([{ ref: MOVIE, events }]))

    // Sans ce compteur, « ignorer » voudrait dire « perdre ».
    expect(measured.unknownEvents).toEqual([{ type: 'LEND', count: 2 }])
  })

  it('compte les entrees annulees', () => {
    const f = createFactory(MOVIE)
    const start = f.start('c1')
    const events = [f.watch(), start, f.voided(start.id)]

    // Deux disparaissent de la projection : la cible et le `VOID` lui-meme.
    expect(metrics(byMedia([{ ref: MOVIE, events }])).voidedEvents).toBe(2)
  })

  it('rapporte les bornes du journal plutot qu un rythme', () => {
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    const measured = metrics(
      byMedia([
        { ref: MOVIE, events: [film.watch()] },
        { ref: SERIES, events: [serie.watch(), serie.start('c1')] },
      ]),
    )

    // Le reducteur rend des dates, pas une duree : convertir deux
    // horodatages en jours demande `Date`, que le domaine n'a pas le droit
    // de connaitre. C'est l'appelant qui fait le calendrier.
    expect(measured.mediaCount).toBe(2)
    expect(measured.firstAt).not.toBeNull()
    expect(measured.lastAt).not.toBeNull()
    expect(measured.firstAt! <= measured.lastAt!).toBe(true)
  })

  it('rend des zeros sur un store vide', () => {
    const measured = metrics(byMedia([]))

    expect(measured).toMatchObject({
      mediaCount: 0,
      cyclesBeyondFirst: 0,
      journalEntries: 0,
      voidedEvents: 0,
      firstAt: null,
      lastAt: null,
    })
  })
})

describe('entrees par jour', () => {
  it('divise les entrees par les jours ecoules', () => {
    expect(entriesPerDay(20, 4)).toBe(5)
  })

  it('arrondit au dixieme', () => {
    expect(entriesPerDay(10, 3)).toBe(3.3)
  })

  it('plancher a un jour', () => {
    // Diviser par une duree plus courte gonflerait la metrique le premier
    // soir, et donnerait une impression d'usage soutenu au moment precis ou
    // l'on cherche a savoir si l'habitude se prend.
    expect(entriesPerDay(6, 0)).toBe(6)
    expect(entriesPerDay(6, 0.25)).toBe(6)
  })

  it('rend zero sans entree', () => {
    expect(entriesPerDay(0, 10)).toBe(0)
  })
})
