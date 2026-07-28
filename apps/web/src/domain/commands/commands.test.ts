import { beforeEach, describe, expect, it } from 'vitest'

import {
  addToLibrary,
  undo,
  advanceStatus,
  toggleFavorite,
  addComment,
  rate,
  advanceProgress,
  removeFromLibrary,
  backdate,
  rewatch,
  type CommandContext,
} from '@/domain/commands'
import { journal } from '@/domain/reducers/journal'
import { currentStatus } from '@/domain/rules/status'
import { testClock, testIds } from '@/domain/test/doubles'
import { createFactory, MOVIE } from '@/domain/test/factory'
import type { DomainEvent, StoredEvent } from '@/domain/types'

/**
 * Commandes du domaine.
 *
 * C'est ici que vivent les règles les plus délicates du modèle : décider si
 * une saisie rétro-datée se rattache à un cycle ouvert ou en minte un neuf,
 * attribuer un `cycle_key`, poser `occurred_at = created_at` pour un geste
 * live, émettre le `SEEN` quand un `PROG` atteint 100.
 *
 * Aucune de ces règles n'est un réducteur. Sans cette couche, elles
 * atterriraient dans les composants React, c'est-à-dire dans la seule
 * couche que le projet exempte de TDD — et un test qui vérifierait le
 * rattachement en partant d'événements déjà bien construits ne vérifierait
 * que la moitié du problème qui ne peut pas se tromper.
 */
describe('commandes', () => {
  let context: CommandContext

  function withEvents(events: readonly StoredEvent[]): CommandContext {
    return { ...context, events }
  }

  /** Applique une commande et rend l'état résultant, comme le ferait le store. */
  function after(
    events: readonly StoredEvent[],
    produced: readonly DomainEvent[],
  ): StoredEvent[] {
    return [...events, ...produced]
  }

  beforeEach(() => {
    context = {
      events: [],
      mediaRef: MOVIE,
      clock: testClock(),
      ids: testIds(),
    }
  })

  describe('horodatage des gestes live', () => {
    it('pose occurred_at = created_at et une precision exacte', () => {
      const [event] = addToLibrary(context)

      expect(event?.occurred_at).toBe(event?.created_at)
      expect(event?.occurred_precision).toBe('exact')
    })

    it('donne un identifiant distinct a chaque evenement produit', () => {
      const produced = backdate(context, {
        date: '2019-05-01T00:00:00.000Z',
        precision: 'year',
        rating: 4,
      })

      const identifiants = new Set(produced.map((e) => e.id))
      expect(identifiants.size).toBe(produced.length)
    })
  })

  describe('ajouter', () => {
    it('ecrit un WATCH', () => {
      const produced = addToLibrary(context)

      expect(produced.map((e) => e.type)).toEqual(['WATCH'])
      expect(produced[0]?.cycle_key).toBeNull()
    })

    it('rend le media a voir', () => {
      const produced = addToLibrary(context)

      expect(currentStatus(produced)).toBe('to-watch')
    })
  })

  describe('avancerStatut — le cycle de la pastille', () => {
    it('a voir vers en cours minte un cycle', () => {
      const base = addToLibrary(context)
      const produced = advanceStatus(withEvents(base))

      expect(produced.map((e) => e.type)).toEqual(['START'])
      expect(produced[0]?.cycle_key).not.toBeNull()
      expect(currentStatus(after(base, produced))).toBe('watching')
    })

    it('en cours vers vu ecrit un SEEN sur le cycle courant', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1')]
      const produced = advanceStatus(withEvents(base))

      expect(produced.map((e) => e.type)).toEqual(['SEEN'])
      expect(produced[0]?.cycle_key).toBe('c1')
      expect(currentStatus(after(base, produced))).toBe('seen')
    })

    it('vu vers abandonne ecrit un DROP sur le cycle courant', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]
      const produced = advanceStatus(withEvents(base))

      expect(produced.map((e) => e.type)).toEqual(['DROP'])
      expect(produced[0]?.cycle_key).toBe('c1')
      expect(currentStatus(after(base, produced))).toBe('dropped')
    })

    it('abandonne vers a voir ecrit un WATCH hors cycle', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.drop('c1')]
      const produced = advanceStatus(withEvents(base))

      expect(produced.map((e) => e.type)).toEqual(['WATCH'])
      expect(produced[0]?.cycle_key).toBeNull()
      expect(currentStatus(after(base, produced))).toBe('to-watch')
    })

    it('boucle en quatre taps', () => {
      let events: StoredEvent[] = [...addToLibrary(context)]
      const statuses = [currentStatus(events)]

      for (let tap = 0; tap < 4; tap += 1) {
        events = after(events, advanceStatus(withEvents(events)))
        statuses.push(currentStatus(events))
      }

      expect(statuses).toEqual(['to-watch', 'watching', 'seen', 'dropped', 'to-watch'])
    })
  })

  describe('progresser', () => {
    it('avance d un increment sur le cycle courant', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 30)]
      const produced = advanceProgress(withEvents(base), { increment: 10 })

      expect(produced.map((e) => e.type)).toEqual(['PROG'])
      expect(produced[0]?.type === 'PROG' && produced[0].payload.percent).toBe(40)
    })

    it('ouvre un cycle si le titre etait a voir', () => {
      const base = addToLibrary(context)
      const produced = advanceProgress(withEvents(base), { increment: 10 })

      expect(produced.map((e) => e.type)).toEqual(['START', 'PROG'])
      expect(produced[0]?.cycle_key).toBe(produced[1]?.cycle_key)
    })

    it('emet un SEEN quand la progression atteint 100', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 95)]
      const produced = advanceProgress(withEvents(base), { increment: 10 })

      expect(produced.map((e) => e.type)).toEqual(['PROG', 'SEEN'])
      expect(produced[0]?.type === 'PROG' && produced[0].payload.percent).toBe(100)
      expect(currentStatus(after(base, produced))).toBe('seen')
    })

    it('ne depasse jamais 100', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 95)]
      const produced = advanceProgress(withEvents(base), { increment: 50 })

      expect(produced[0]?.type === 'PROG' && produced[0].payload.percent).toBe(100)
    })

    it('reporte le label connu avec sa date de saisie', () => {
      const f = createFactory()
      const base = [
        f.watch(),
        f.start('c1'),
        f.prog('c1', 30, { label: 'S02E05', labelCreatedAt: '2026-01-01T00:00:03.000Z' }),
      ]
      const produced = advanceProgress(withEvents(base), { increment: 10 })

      const prog = produced[0]
      expect(prog?.type === 'PROG' && prog.payload.label).toBe('S02E05')
      // La date d'origine du label est conservee : c'est ce qui permet de
      // savoir qu'il decrit un point plus ancien que l'avancement affiche.
      expect(prog?.type === 'PROG' && prog.payload.label_created_at).toBe(
        '2026-01-01T00:00:03.000Z',
      )
    })

    it('remplace le label quand on en fournit un nouveau', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 30, { label: 'S02E05' })]
      const produced = advanceProgress(withEvents(base), { increment: 10, label: 'S02E06' })

      const prog = produced[0]
      expect(prog?.type === 'PROG' && prog.payload.label).toBe('S02E06')
      expect(prog?.type === 'PROG' && prog.payload.label_created_at).toBe(
        prog?.created_at,
      )
    })
  })

  describe('retroDater — la regle de rattachement', () => {
    it('rattache au cycle ouvert quand sa date de rang precede la saisie', () => {
      const f = createFactory()
      // « En fait je l'ai fini la semaine derniere. »
      const base = [f.watch(), f.start('watching', '2026-01-01T20:00:00.000Z')]

      const produced = backdate(withEvents(base), {
        date: '2026-07-20T20:00:00.000Z',
        precision: 'exact',
      })

      expect(produced.map((e) => e.type)).toEqual(['SEEN'])
      expect(produced[0]?.cycle_key).toBe('watching')
      expect(currentStatus(after(base, produced))).toBe('seen')
    })

    it('minte un cycle neuf quand la saisie precede le cycle ouvert', () => {
      const f = createFactory()
      // « Je l'avais deja vu en 2019 » sur un titre en cours depuis 2026.
      const base = [f.watch(), f.start('watching', '2026-01-01T20:00:00.000Z')]

      const produced = backdate(withEvents(base), {
        date: '2019-05-01T20:00:00.000Z',
        precision: 'exact',
      })

      expect(produced.map((e) => e.type)).toEqual(['START', 'SEEN'])
      expect(produced[0]?.cycle_key).not.toBe('watching')
      // Le titre reste en cours : le cycle de 2019 est de rang inferieur.
      expect(currentStatus(after(base, produced))).toBe('watching')
    })

    it('minte un cycle neuf quand aucun cycle n est ouvert', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]

      const produced = backdate(withEvents(base), {
        date: '2015-01-01T20:00:00.000Z',
        precision: 'year',
      })

      expect(produced.map((e) => e.type)).toEqual(['START', 'SEEN'])
    })

    it('ajoute le media s il est absent', () => {
      const produced = backdate(context, {
        date: '2019-05-01T20:00:00.000Z',
        precision: 'year',
      })

      expect(produced.map((e) => e.type)).toEqual(['WATCH', 'START', 'SEEN'])
    })

    it('pose la date saisie et sa precision sur le cycle', () => {
      const produced = backdate(context, {
        date: '2019-01-01T00:00:00.000Z',
        precision: 'year',
      })

      const start = produced.find((e) => e.type === 'START')
      expect(start?.occurred_at).toBe('2019-01-01T00:00:00.000Z')
      expect(start?.occurred_precision).toBe('year')
    })

    it('pose occurred_at null pour une precision inconnue', () => {
      const produced = backdate(context, { date: null, precision: 'unknown' })

      const start = produced.find((e) => e.type === 'START')
      expect(start?.occurred_at).toBeNull()
      expect(start?.occurred_precision).toBe('unknown')
    })

    it('attache la note et le commentaire au meme cycle', () => {
      const produced = backdate(context, {
        date: '2019-05-01T20:00:00.000Z',
        precision: 'year',
        rating: 5,
        comment: 'un choc',
      })

      const start = produced.find((e) => e.type === 'START')
      const rate = produced.find((e) => e.type === 'RATE')
      const note = produced.find((e) => e.type === 'NOTE')

      expect(rate?.cycle_key).toBe(start?.cycle_key)
      expect(note?.cycle_key).toBe(start?.cycle_key)
      expect(rate?.type === 'RATE' && rate.payload.rating).toBe(5)
      expect(note?.type === 'NOTE' && note.payload.text).toBe('un choc')
    })

    it('numerote correctement trois visionnages saisis a rebours', () => {
      let events: StoredEvent[] = []
      for (const annee of ['2024', '2021', '2019']) {
        events = after(
          events,
          backdate(withEvents(events), {
            date: `${annee}-01-01T00:00:00.000Z`,
            precision: 'year',
          }),
        )
      }

      const numeros = journal(events)
        .filter((e) => e.kind === 'marker')
        .map((e) => (e.kind === 'marker' ? e.number : 0))

      // Affichage decroissant : le plus recent en haut.
      expect(numeros).toEqual([3, 2, 1])
    })
  })

  describe('revoir', () => {
    it('minte un REWATCH, jamais un START', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]
      const produced = rewatch(withEvents(base))

      expect(produced.map((e) => e.type)).toEqual(['REWATCH'])
      expect(produced[0]?.cycle_key).not.toBe('c1')
      expect(currentStatus(after(base, produced))).toBe('watching')
    })

    it('ne rouvre jamais un cycle abandonne', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.drop('c1')]
      const produced = rewatch(withEvents(base))

      expect(produced[0]?.cycle_key).not.toBe('c1')
    })
  })

  describe('noter et commenter', () => {
    it('attachent au cycle courant', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1')]

      expect(rate(withEvents(base), 4)[0]?.cycle_key).toBe('c1')
      expect(addComment(withEvents(base), 'pas mal')[0]?.cycle_key).toBe('c1')
    })

    it('effacent la note avec un rating null', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.rate('c1', 4)]
      const produced = rate(withEvents(base), null)

      expect(produced[0]?.type === 'RATE' && produced[0].payload.rating).toBeNull()
    })

    it('ouvrent un cycle si aucun n existe', () => {
      const base = addToLibrary(context)
      const produced = rate(withEvents(base), 4)

      // Noter un titre jamais commence implique qu'on l'a vu.
      expect(produced.map((e) => e.type)).toEqual(['START', 'RATE'])
    })
  })

  describe('coup de coeur, retrait, annulation', () => {
    it('bascule le coup de coeur', () => {
      const base = addToLibrary(context)
      const first = toggleFavorite(withEvents(base))
      expect(first.map((e) => e.type)).toEqual(['FAV'])
      expect(first[0]?.cycle_key).toBeNull()

      const second = toggleFavorite(withEvents(after(base, first)))
      expect(second.map((e) => e.type)).toEqual(['UNFAV'])
    })

    it('retire le media sans effacer son historique', () => {
      const f = createFactory()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]
      const produced = removeFromLibrary(withEvents(base))

      expect(produced.map((e) => e.type)).toEqual(['REMOVE'])
      expect(currentStatus(after(base, produced))).toBe('absent')
    })

    it('annule un evenement par son identifiant', () => {
      const f = createFactory()
      const drop = f.drop('c1')
      const base = [f.watch(), f.start('c1'), f.seen('c1'), drop]

      const produced = undo(withEvents(base), drop.id)

      expect(produced.map((e) => e.type)).toEqual(['VOID'])
      expect(produced[0]?.type === 'VOID' && produced[0].payload.target).toBe(drop.id)
      expect(currentStatus(after(base, produced))).toBe('seen')
    })
  })
})
