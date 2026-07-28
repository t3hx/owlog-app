import { describe, expect, it } from 'vitest'

import { log } from '@/domain/reducers/log'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'

/**
 * LOG global.
 *
 * Flux plat de tout ce qui a été fait, tous médias confondus. Ce qui le
 * distingue du journal de la fiche tient en une phrase : il ne groupe rien.
 * Pas de marqueur `— visionnage #N —`, parce que numéroter les cycles de
 * titres sans rapport les uns sous les autres n'apprend rien.
 */
describe('flux global', () => {
  it('mele plusieurs medias dans un seul flux', () => {
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    // Alternés à l'écriture : c'est tout l'intérêt de l'écran.
    const events = [film.watch(), serie.watch(), film.start('c1'), serie.start('c2')]

    const entries = log(events)

    expect(entries).toHaveLength(4)
    expect(entries.map((entry) => entry.event.media_ref)).toEqual([
      SERIES,
      MOVIE,
      SERIES,
      MOVIE,
    ])
  })

  it('rend du plus recent au plus ancien', () => {
    const f = createFactory(MOVIE)
    const events = [f.watch(), f.start('c1'), f.seen('c1')]

    expect(log(events).map((entry) => entry.event.type)).toEqual(['SEEN', 'START', 'WATCH'])
  })

  it('exclut les PROG', () => {
    const f = createFactory(MOVIE)
    const events = [f.watch(), f.start('c1'), f.prog('c1', 40, { label: 'S01E04' })]

    // La progression reste visible sur l'accueil et sauvegardee dans le
    // `.log`. Personne ne veut relire qu'il a pousse une barre a 40 %.
    expect(log(events).map((entry) => entry.event.type)).toEqual(['START', 'WATCH'])
  })

  it('ecarte ce qui a ete annule', () => {
    const f = createFactory(MOVIE)
    const watch = f.watch()
    const start = f.start('c1')
    const events = [watch, start, f.voided(start.id)]

    // Le `VOID` sort lui aussi de la projection : il a fait son travail, et
    // le laisser passer afficherait « entree annulee » sous l'entree qui
    // vient de disparaitre. C'est la regle d'`applyVoids`, appliquee ici
    // parce que le flux la consomme comme tous les autres reducteurs.
    expect(log(events).map((entry) => entry.event.type)).toEqual(['WATCH'])
  })

  it('place les dates inconnues en queue', () => {
    const f = createFactory(MOVIE)
    const undated = f.start('c1', null, 'unknown')
    const events = [undated, f.watch()]

    // On ne peut pas les placer chronologiquement. Les mettre en tete ferait
    // croire qu'elles sont recentes ; les mettre en queue dit qu'on ne sait
    // pas, ce qui est vrai.
    const entries = log(events)
    expect(entries[entries.length - 1]?.event.id).toBe(undated.id)
  })

  it('departage deux dates identiques par ordre d ecriture', () => {
    const f = createFactory(MOVIE)
    const at = '2019-06-01T00:00:00.000Z'
    // C'est le cas du retro-datage : un START et un SEEN poses ensemble
    // portent exactement la meme date saisie.
    const start = f.start('c1', at)
    const seen = f.seen('c1', at)

    expect(log([start, seen]).map((entry) => entry.event.id)).toEqual([seen.id, start.id])
  })

  it('signale un type venu d une version ulterieure du client', () => {
    const f = createFactory(MOVIE)
    const events = [f.watch(), f.unknown('LEND')]

    // Au temps 2, deux appareils tourneront sur deux versions. Un type
    // inconnu s'affiche brut plutot que de faire disparaitre une ligne.
    const entries = log(events)
    expect(entries[0]?.known).toBe(false)
    expect(entries[1]?.known).toBe(true)
  })

  it('rend une liste vide sans evenement', () => {
    expect(log([])).toEqual([])
  })

  /**
   * Critère d'acceptation de l'étape : « le flux montre la même chose que
   * l'export `.log`, en plus lisible ».
   *
   * Le comparer octet à octet n'aurait pas de sens — l'export est une
   * sauvegarde et écrit jusqu'aux entrées annulées, le flux est une
   * projection. Ce qui se vérifie, et qui est le vrai risque, c'est qu'un
   * type d'événement écrit par le domaine soit oublié à l'affichage. Ajouter
   * `LEND` au modèle sans toucher au flux le ferait disparaître en silence,
   * et un journal qui perd des lignes ne vaut rien.
   */
  it('n oublie aucun type que le domaine sait ecrire', () => {
    const f = createFactory(MOVIE)
    const written = [
      f.watch(),
      f.start('c1'),
      f.rate('c1', 4),
      f.note('c1', 'excellent'),
      f.seen('c1'),
      f.rewatch('c2'),
      f.drop('c2'),
      f.fav(),
      f.unfav(),
      f.remove(),
    ]

    const rendered = new Set(log(written).map((entry) => entry.event.type))

    for (const event of written) {
      expect(rendered.has(event.type)).toBe(true)
    }
  })
})
