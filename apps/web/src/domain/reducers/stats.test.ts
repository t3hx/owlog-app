import { describe, expect, it } from 'vitest'

import { mediaState, type MediaStateRow } from '@/domain/reducers/mediaState'
import {
  stats,
  type StatsMedia,
  type StatsPeriod,
  type StatsWindow,
} from '@/domain/reducers/stats'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'
import type { MediaRef, StoredEvent, Timestamp } from '@/domain/types'

/**
 * Écran de stats.
 *
 * Critère d'acceptation de l'étape 11 : « les chiffres bougent, et les
 * exclusions sont affichées plutôt que masquées ». La seconde moitié est la
 * plus importante — une durée totale qui laisse tomber en silence les séries
 * dont TMDB ne donne pas la durée est un chiffre faux qui a l'air juste.
 */
const NOW = '2026-07-29T00:00:00.000Z' as Timestamp

/** Dans les 30 derniers jours. */
const RECENT = '2026-07-20T20:00:00.000Z' as Timestamp
/** Dans la fenêtre de 30 jours précédente, pour le delta. */
const PREVIOUS = '2026-06-20T20:00:00.000Z' as Timestamp
/** Hors 30 jours, dans l'année. */
const THIS_YEAR = '2026-03-01T20:00:00.000Z' as Timestamp
/** Hors de tout, sauf « tout ». */
const LONG_AGO = '2019-06-01T20:00:00.000Z' as Timestamp

const FILM: StatsMedia = {
  kind: 'movie',
  totalRuntime: 120,
  numberOfEpisodes: null,
  genres: ['Science-Fiction'],
  complete: true,
}

const SERIE: StatsMedia = {
  kind: 'tv',
  totalRuntime: 600,
  numberOfEpisodes: 10,
  genres: ['Drame'],
  complete: true,
}

/**
 * Fenêtres du sélecteur, calculées ici comme l'écran les calcule.
 *
 * Le domaine reçoit des bornes, jamais l'horloge : c'est ce qui lui interdit
 * `Date` et ce qui rend ces tests déterministes sans truquer le temps.
 */
const WINDOWS: Record<StatsPeriod, readonly [StatsWindow | null, StatsWindow | null]> = {
  month: [
    { from: '2026-06-29T00:00:00.000Z' as Timestamp, to: NOW },
    { from: '2026-05-30T00:00:00.000Z' as Timestamp, to: '2026-06-29T00:00:00.000Z' as Timestamp },
  ],
  year: [
    { from: '2025-07-29T00:00:00.000Z' as Timestamp, to: NOW },
    { from: '2024-07-29T00:00:00.000Z' as Timestamp, to: '2025-07-29T00:00:00.000Z' as Timestamp },
  ],
  all: [null, null],
}

function build(
  entries: readonly { ref: MediaRef; events: readonly StoredEvent[]; media: StatsMedia }[],
  period: StatsPeriod = 'all',
) {
  const eventsByMedia = new Map<MediaRef, readonly StoredEvent[]>()
  const cache = new Map<MediaRef, StatsMedia>()
  const states: MediaStateRow[] = []

  for (const entry of entries) {
    eventsByMedia.set(entry.ref, entry.events)
    cache.set(entry.ref, entry.media)
    states.push(mediaState(entry.events, entry.ref))
  }

  const [window, previousWindow] = WINDOWS[period]

  return stats({ states, eventsByMedia, cache, period, window, previousWindow })
}

describe('temps total', () => {
  it('compte la duree d un film abouti', () => {
    const f = createFactory(MOVIE)
    const view = build([
      { ref: MOVIE, media: FILM, events: [f.watch(), f.start('c1', RECENT), f.seen('c1', RECENT)] },
    ])

    expect(view.totalMinutes).toBe(120)
    expect(view.movieMinutes).toBe(120)
  })

  it('compte deux fois un film vu deux fois', () => {
    const f = createFactory(MOVIE)
    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [
          f.watch(),
          f.start('c1', LONG_AGO),
          f.seen('c1', LONG_AGO),
          f.rewatch('c2', RECENT),
          f.seen('c2', RECENT),
        ],
      },
    ])

    // C'est la these du produit : le visionnage est l'unite, pas le film.
    // Compter le titre une fois rendrait la statistique aveugle au
    // revisionnage, qui est precisement ce que l'app existe pour capter.
    expect(view.totalMinutes).toBe(240)
    expect(view.rewatches).toBe(1)
  })

  it('exclut une serie sans duree connue, et le dit', () => {
    const f = createFactory(SERIES)
    const view = build([
      {
        ref: SERIES,
        media: { ...SERIE, totalRuntime: null },
        events: [f.watch(), f.start('c1', RECENT), f.seen('c1', RECENT)],
      },
    ])

    // TMDB rend `episode_run_time` vide tres souvent, y compris sur des
    // series majeures. Masquer ces titres ferait un total credible et faux.
    expect(view.totalMinutes).toBe(0)
    expect(view.seriesWithoutRuntime).toBe(1)
  })

  it('compte l avancement d une serie en cours, sur « tout » seulement', () => {
    const f = createFactory(SERIES)
    const events = [f.watch(), f.start('c1', RECENT), f.prog('c1', 60)]

    expect(build([{ ref: SERIES, media: SERIE, events }]).seriesMinutes).toBe(360)

    // `percent` est une valeur d'aujourd'hui : elle n'a pas de date. La
    // ranger dans une fenetre de 30 jours reviendrait a lui en inventer une.
    expect(
      build([{ ref: SERIES, media: SERIE, events }], 'month').seriesMinutes,
    ).toBe(0)
  })
})

describe('periode', () => {
  it('ecarte un cycle abouti hors fenetre', () => {
    const f = createFactory(MOVIE)
    const events = [f.watch(), f.start('c1', THIS_YEAR), f.seen('c1', THIS_YEAR)]

    expect(build([{ ref: MOVIE, media: FILM, events }], 'month').totalMinutes).toBe(0)
    expect(build([{ ref: MOVIE, media: FILM, events }], 'year').totalMinutes).toBe(120)
  })

  it('ecarte une date trop grossiere pour la fenetre', () => {
    const f = createFactory(MOVIE)
    // « vu en 2026 » ne peut pas entrer dans une agregation de 30 jours :
    // rien ne dit que c'etait ces trente jours-la.
    const events = [
      f.watch(),
      f.start('c1', '2026-01-01T00:00:00.000Z', 'year'),
      f.seen('c1', '2026-01-01T00:00:00.000Z', 'year'),
    ]

    expect(build([{ ref: MOVIE, media: FILM, events }], 'month').totalMinutes).toBe(0)
    expect(build([{ ref: MOVIE, media: FILM, events }], 'all').totalMinutes).toBe(120)
  })

  it('mesure la fenetre precedente de meme longueur', () => {
    const f = createFactory(MOVIE)
    const view = build(
      [
        {
          ref: MOVIE,
          media: FILM,
          events: [
            f.watch(),
            f.start('c1', RECENT),
            f.seen('c1', RECENT),
            f.rewatch('c2', PREVIOUS),
            f.seen('c2', PREVIOUS),
          ],
        },
      ],
      'month',
    )

    expect(view.totalMinutes).toBe(120)
    expect(view.previousMinutes).toBe(120)
  })

  it('n a pas de periode precedente sur « tout »', () => {
    const f = createFactory(MOVIE)
    const view = build([
      { ref: MOVIE, media: FILM, events: [f.watch(), f.start('c1', RECENT), f.seen('c1', RECENT)] },
    ])

    // Il n'y a rien avant « tout ». Afficher un delta de zero laisserait
    // croire a une annee blanche.
    expect(view.previousMinutes).toBeNull()
  })
})

describe('repartition et tuiles', () => {
  it('separe films et series, en minutes et en titres', () => {
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [film.watch(), film.start('c1', RECENT), film.seen('c1', RECENT)],
      },
      {
        ref: SERIES,
        media: SERIE,
        events: [serie.watch(), serie.start('c1', RECENT), serie.seen('c1', RECENT)],
      },
    ])

    expect(view.movieMinutes).toBe(120)
    expect(view.seriesMinutes).toBe(600)
    expect(view.movieCount).toBe(1)
    expect(view.seriesCount).toBe(1)
  })

  it('compte les vus, les en cours et les coups de coeur', () => {
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [film.watch(), film.start('c1', RECENT), film.seen('c1', RECENT), film.fav()],
      },
      { ref: SERIES, media: SERIE, events: [serie.watch(), serie.start('c1', RECENT)] },
    ])

    expect(view.counts).toEqual({ seen: 1, watching: 1, favorites: 1 })
  })
})

describe('notes', () => {
  it('range les notes en trois groupes et rend la moyenne', () => {
    const good = createFactory(MOVIE)
    const mid = createFactory(SERIES)
    const bad = createFactory('tmdb:movie/603')

    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [good.watch(), good.start('c1', RECENT), good.rate('c1', 5)],
      },
      {
        ref: SERIES,
        media: SERIE,
        events: [mid.watch(), mid.start('c1', RECENT), mid.rate('c1', 3)],
      },
      {
        ref: 'tmdb:movie/603',
        media: FILM,
        events: [bad.watch(), bad.start('c1', RECENT), bad.rate('c1', 2)],
      },
    ])

    expect(view.ratings).toMatchObject({ good: 1, mid: 1, bad: 1, rated: 3 })
    expect(view.ratings.average).toBeCloseTo(3.3, 1)
  })

  it('note par cycle et non par media', () => {
    const f = createFactory(MOVIE)
    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [
          f.watch(),
          f.start('c1', LONG_AGO),
          f.rate('c1', 3),
          f.seen('c1', LONG_AGO),
          f.rewatch('c2', RECENT),
          f.rate('c2', 5),
        ],
      },
    ])

    // ★3 en 2019 et ★5 en 2026 sur le meme titre : deux notes, pas une.
    expect(view.ratings.rated).toBe(2)
    expect(view.ratings.average).toBe(4)
  })

  it('ignore une note effacee', () => {
    const f = createFactory(MOVIE)
    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [f.watch(), f.start('c1', RECENT), f.rate('c1', 4), f.rate('c1', null)],
      },
    ])

    // Le re-tap sur la meme etoile efface : c'est une absence de note, pas
    // un zero. La compter comme un zero ecraserait la moyenne.
    expect(view.ratings.rated).toBe(0)
    expect(view.ratings.average).toBeNull()
  })
})

describe('genres', () => {
  it('classe les genres des medias complets', () => {
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    const view = build([
      {
        ref: MOVIE,
        media: { ...FILM, genres: ['Science-Fiction', 'Drame'] },
        events: [film.watch(), film.start('c1', RECENT), film.seen('c1', RECENT)],
      },
      {
        ref: SERIES,
        media: { ...SERIE, genres: ['Drame'] },
        events: [serie.watch(), serie.start('c1', RECENT), serie.seen('c1', RECENT)],
      },
    ])

    expect(view.genres.map((g) => g.name)).toEqual(['Drame', 'Science-Fiction'])
    expect(view.genres[0]?.percent).toBe(67)
  })

  it('exclut un media dont la fiche n a jamais ete ouverte, et le dit', () => {
    const f = createFactory(MOVIE)
    const view = build([
      {
        ref: MOVIE,
        media: { ...FILM, complete: false, genres: [] },
        events: [f.watch(), f.start('c1', RECENT), f.seen('c1', RECENT)],
      },
    ])

    // Une ligne partielle vient d'un resultat de recherche : elle ne porte
    // pas les genres. La compter comme « sans genre » inventerait une
    // categorie ; l'exclure en silence ferait un classement biaise.
    expect(view.genres).toEqual([])
    expect(view.mediaWithoutGenres).toBe(1)
  })
})

describe('completion et episodes', () => {
  it('rapporte les cycles aboutis aux cycles ouverts', () => {
    const done = createFactory(MOVIE)
    const open = createFactory(SERIES)

    const view = build([
      {
        ref: MOVIE,
        media: FILM,
        events: [done.watch(), done.start('c1', RECENT), done.seen('c1', RECENT)],
      },
      { ref: SERIES, media: SERIE, events: [open.watch(), open.start('c1', RECENT)] },
    ])

    expect(view.completion).toBe(50)
  })

  it('compte les episodes vus depuis l avancement', () => {
    const f = createFactory(SERIES)
    const view = build([
      { ref: SERIES, media: SERIE, events: [f.watch(), f.start('c1', RECENT), f.prog('c1', 60)] },
    ])

    // 60 % de dix episodes font six episodes.
    expect(view.episodesSeen).toBe(6)
  })

  it('rend des zeros lisibles sur une bibliotheque vide', () => {
    const view = build([])

    expect(view.totalMinutes).toBe(0)
    expect(view.completion).toBeNull()
    expect(view.ratings.average).toBeNull()
    expect(view.genres).toEqual([])
  })
})
