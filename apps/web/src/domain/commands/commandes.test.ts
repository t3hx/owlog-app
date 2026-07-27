import { beforeEach, describe, expect, it } from 'vitest'

import {
  ajouter,
  annuler,
  avancerStatut,
  basculerCoupDeCoeur,
  commenter,
  noter,
  progresser,
  retirer,
  retroDater,
  revoir,
  type Contexte,
} from '@/domain/commands'
import { journal } from '@/domain/reducers/journal'
import { statutCourant } from '@/domain/rules/statut'
import { horlogeDeTest, idsDeTest } from '@/domain/test/doubles'
import { creerFabrique, FILM } from '@/domain/test/fabrique'
import type { Evenement, EvenementStocke } from '@/domain/types'

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
  let contexte: Contexte

  function avec(evenements: readonly EvenementStocke[]): Contexte {
    return { ...contexte, evenements }
  }

  /** Applique une commande et rend l'état résultant, comme le ferait le store. */
  function apres(
    evenements: readonly EvenementStocke[],
    produits: readonly Evenement[],
  ): EvenementStocke[] {
    return [...evenements, ...produits]
  }

  beforeEach(() => {
    contexte = {
      evenements: [],
      mediaRef: FILM,
      horloge: horlogeDeTest(),
      ids: idsDeTest(),
    }
  })

  describe('horodatage des gestes live', () => {
    it('pose occurred_at = created_at et une precision exacte', () => {
      const [evenement] = ajouter(contexte)

      expect(evenement?.occurred_at).toBe(evenement?.created_at)
      expect(evenement?.occurred_precision).toBe('exact')
    })

    it('donne un identifiant distinct a chaque evenement produit', () => {
      const produits = retroDater(contexte, {
        date: '2019-05-01T00:00:00.000Z',
        precision: 'annee',
        note: 4,
      })

      const identifiants = new Set(produits.map((e) => e.id))
      expect(identifiants.size).toBe(produits.length)
    })
  })

  describe('ajouter', () => {
    it('ecrit un WATCH', () => {
      const produits = ajouter(contexte)

      expect(produits.map((e) => e.type)).toEqual(['WATCH'])
      expect(produits[0]?.cycle_key).toBeNull()
    })

    it('rend le media a voir', () => {
      const produits = ajouter(contexte)

      expect(statutCourant(produits)).toBe('a-voir')
    })
  })

  describe('avancerStatut — le cycle de la pastille', () => {
    it('a voir vers en cours minte un cycle', () => {
      const base = ajouter(contexte)
      const produits = avancerStatut(avec(base))

      expect(produits.map((e) => e.type)).toEqual(['START'])
      expect(produits[0]?.cycle_key).not.toBeNull()
      expect(statutCourant(apres(base, produits))).toBe('en-cours')
    })

    it('en cours vers vu ecrit un SEEN sur le cycle courant', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1')]
      const produits = avancerStatut(avec(base))

      expect(produits.map((e) => e.type)).toEqual(['SEEN'])
      expect(produits[0]?.cycle_key).toBe('c1')
      expect(statutCourant(apres(base, produits))).toBe('vu')
    })

    it('vu vers abandonne ecrit un DROP sur le cycle courant', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]
      const produits = avancerStatut(avec(base))

      expect(produits.map((e) => e.type)).toEqual(['DROP'])
      expect(produits[0]?.cycle_key).toBe('c1')
      expect(statutCourant(apres(base, produits))).toBe('abandonne')
    })

    it('abandonne vers a voir ecrit un WATCH hors cycle', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.drop('c1')]
      const produits = avancerStatut(avec(base))

      expect(produits.map((e) => e.type)).toEqual(['WATCH'])
      expect(produits[0]?.cycle_key).toBeNull()
      expect(statutCourant(apres(base, produits))).toBe('a-voir')
    })

    it('boucle en quatre taps', () => {
      let evenements: EvenementStocke[] = [...ajouter(contexte)]
      const statuts = [statutCourant(evenements)]

      for (let tap = 0; tap < 4; tap += 1) {
        evenements = apres(evenements, avancerStatut(avec(evenements)))
        statuts.push(statutCourant(evenements))
      }

      expect(statuts).toEqual(['a-voir', 'en-cours', 'vu', 'abandonne', 'a-voir'])
    })
  })

  describe('progresser', () => {
    it('avance d un increment sur le cycle courant', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 30)]
      const produits = progresser(avec(base), { increment: 10 })

      expect(produits.map((e) => e.type)).toEqual(['PROG'])
      expect(produits[0]?.type === 'PROG' && produits[0].payload.percent).toBe(40)
    })

    it('ouvre un cycle si le titre etait a voir', () => {
      const base = ajouter(contexte)
      const produits = progresser(avec(base), { increment: 10 })

      expect(produits.map((e) => e.type)).toEqual(['START', 'PROG'])
      expect(produits[0]?.cycle_key).toBe(produits[1]?.cycle_key)
    })

    it('emet un SEEN quand la progression atteint 100', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 95)]
      const produits = progresser(avec(base), { increment: 10 })

      expect(produits.map((e) => e.type)).toEqual(['PROG', 'SEEN'])
      expect(produits[0]?.type === 'PROG' && produits[0].payload.percent).toBe(100)
      expect(statutCourant(apres(base, produits))).toBe('vu')
    })

    it('ne depasse jamais 100', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 95)]
      const produits = progresser(avec(base), { increment: 50 })

      expect(produits[0]?.type === 'PROG' && produits[0].payload.percent).toBe(100)
    })

    it('reporte le label connu avec sa date de saisie', () => {
      const f = creerFabrique()
      const base = [
        f.watch(),
        f.start('c1'),
        f.prog('c1', 30, { label: 'S02E05', labelCreatedAt: '2026-01-01T00:00:03.000Z' }),
      ]
      const produits = progresser(avec(base), { increment: 10 })

      const prog = produits[0]
      expect(prog?.type === 'PROG' && prog.payload.label).toBe('S02E05')
      // La date d'origine du label est conservee : c'est ce qui permet de
      // savoir qu'il decrit un point plus ancien que l'avancement affiche.
      expect(prog?.type === 'PROG' && prog.payload.label_created_at).toBe(
        '2026-01-01T00:00:03.000Z',
      )
    })

    it('remplace le label quand on en fournit un nouveau', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.prog('c1', 30, { label: 'S02E05' })]
      const produits = progresser(avec(base), { increment: 10, label: 'S02E06' })

      const prog = produits[0]
      expect(prog?.type === 'PROG' && prog.payload.label).toBe('S02E06')
      expect(prog?.type === 'PROG' && prog.payload.label_created_at).toBe(
        prog?.created_at,
      )
    })
  })

  describe('retroDater — la regle de rattachement', () => {
    it('rattache au cycle ouvert quand sa date de rang precede la saisie', () => {
      const f = creerFabrique()
      // « En fait je l'ai fini la semaine derniere. »
      const base = [f.watch(), f.start('en-cours', '2026-01-01T20:00:00.000Z')]

      const produits = retroDater(avec(base), {
        date: '2026-07-20T20:00:00.000Z',
        precision: 'exact',
      })

      expect(produits.map((e) => e.type)).toEqual(['SEEN'])
      expect(produits[0]?.cycle_key).toBe('en-cours')
      expect(statutCourant(apres(base, produits))).toBe('vu')
    })

    it('minte un cycle neuf quand la saisie precede le cycle ouvert', () => {
      const f = creerFabrique()
      // « Je l'avais deja vu en 2019 » sur un titre en cours depuis 2026.
      const base = [f.watch(), f.start('en-cours', '2026-01-01T20:00:00.000Z')]

      const produits = retroDater(avec(base), {
        date: '2019-05-01T20:00:00.000Z',
        precision: 'exact',
      })

      expect(produits.map((e) => e.type)).toEqual(['START', 'SEEN'])
      expect(produits[0]?.cycle_key).not.toBe('en-cours')
      // Le titre reste en cours : le cycle de 2019 est de rang inferieur.
      expect(statutCourant(apres(base, produits))).toBe('en-cours')
    })

    it('minte un cycle neuf quand aucun cycle n est ouvert', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]

      const produits = retroDater(avec(base), {
        date: '2015-01-01T20:00:00.000Z',
        precision: 'annee',
      })

      expect(produits.map((e) => e.type)).toEqual(['START', 'SEEN'])
    })

    it('ajoute le media s il est absent', () => {
      const produits = retroDater(contexte, {
        date: '2019-05-01T20:00:00.000Z',
        precision: 'annee',
      })

      expect(produits.map((e) => e.type)).toEqual(['WATCH', 'START', 'SEEN'])
    })

    it('pose la date saisie et sa precision sur le cycle', () => {
      const produits = retroDater(contexte, {
        date: '2019-01-01T00:00:00.000Z',
        precision: 'annee',
      })

      const start = produits.find((e) => e.type === 'START')
      expect(start?.occurred_at).toBe('2019-01-01T00:00:00.000Z')
      expect(start?.occurred_precision).toBe('annee')
    })

    it('pose occurred_at null pour une precision inconnue', () => {
      const produits = retroDater(contexte, { date: null, precision: 'inconnu' })

      const start = produits.find((e) => e.type === 'START')
      expect(start?.occurred_at).toBeNull()
      expect(start?.occurred_precision).toBe('inconnu')
    })

    it('attache la note et le commentaire au meme cycle', () => {
      const produits = retroDater(contexte, {
        date: '2019-05-01T20:00:00.000Z',
        precision: 'annee',
        note: 5,
        commentaire: 'un choc',
      })

      const start = produits.find((e) => e.type === 'START')
      const rate = produits.find((e) => e.type === 'RATE')
      const note = produits.find((e) => e.type === 'NOTE')

      expect(rate?.cycle_key).toBe(start?.cycle_key)
      expect(note?.cycle_key).toBe(start?.cycle_key)
      expect(rate?.type === 'RATE' && rate.payload.rating).toBe(5)
      expect(note?.type === 'NOTE' && note.payload.text).toBe('un choc')
    })

    it('numerote correctement trois visionnages saisis a rebours', () => {
      let evenements: EvenementStocke[] = []
      for (const annee of ['2024', '2021', '2019']) {
        evenements = apres(
          evenements,
          retroDater(avec(evenements), {
            date: `${annee}-01-01T00:00:00.000Z`,
            precision: 'annee',
          }),
        )
      }

      const numeros = journal(evenements)
        .filter((e) => e.genre === 'marqueur')
        .map((e) => (e.genre === 'marqueur' ? e.numero : 0))

      // Affichage decroissant : le plus recent en haut.
      expect(numeros).toEqual([3, 2, 1])
    })
  })

  describe('revoir', () => {
    it('minte un REWATCH, jamais un START', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]
      const produits = revoir(avec(base))

      expect(produits.map((e) => e.type)).toEqual(['REWATCH'])
      expect(produits[0]?.cycle_key).not.toBe('c1')
      expect(statutCourant(apres(base, produits))).toBe('en-cours')
    })

    it('ne rouvre jamais un cycle abandonne', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.drop('c1')]
      const produits = revoir(avec(base))

      expect(produits[0]?.cycle_key).not.toBe('c1')
    })
  })

  describe('noter et commenter', () => {
    it('attachent au cycle courant', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1')]

      expect(noter(avec(base), 4)[0]?.cycle_key).toBe('c1')
      expect(commenter(avec(base), 'pas mal')[0]?.cycle_key).toBe('c1')
    })

    it('effacent la note avec un rating null', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.rate('c1', 4)]
      const produits = noter(avec(base), null)

      expect(produits[0]?.type === 'RATE' && produits[0].payload.rating).toBeNull()
    })

    it('ouvrent un cycle si aucun n existe', () => {
      const base = ajouter(contexte)
      const produits = noter(avec(base), 4)

      // Noter un titre jamais commence implique qu'on l'a vu.
      expect(produits.map((e) => e.type)).toEqual(['START', 'RATE'])
    })
  })

  describe('coup de coeur, retrait, annulation', () => {
    it('bascule le coup de coeur', () => {
      const base = ajouter(contexte)
      const premier = basculerCoupDeCoeur(avec(base))
      expect(premier.map((e) => e.type)).toEqual(['FAV'])
      expect(premier[0]?.cycle_key).toBeNull()

      const second = basculerCoupDeCoeur(avec(apres(base, premier)))
      expect(second.map((e) => e.type)).toEqual(['UNFAV'])
    })

    it('retire le media sans effacer son historique', () => {
      const f = creerFabrique()
      const base = [f.watch(), f.start('c1'), f.seen('c1')]
      const produits = retirer(avec(base))

      expect(produits.map((e) => e.type)).toEqual(['REMOVE'])
      expect(statutCourant(apres(base, produits))).toBe('absent')
    })

    it('annule un evenement par son identifiant', () => {
      const f = creerFabrique()
      const drop = f.drop('c1')
      const base = [f.watch(), f.start('c1'), f.seen('c1'), drop]

      const produits = annuler(avec(base), drop.id)

      expect(produits.map((e) => e.type)).toEqual(['VOID'])
      expect(produits[0]?.type === 'VOID' && produits[0].payload.target).toBe(drop.id)
      expect(statutCourant(apres(base, produits))).toBe('vu')
    })
  })
})
