import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { mediaState, type MediaStateRow, type StoredEvent } from '@owlog/domain'
import { createFactory, MOVIE, SERIES } from '@owlog/domain/test'
import i18next from '@/i18n'
import { partialCacheRow, type MediaCacheRow } from '@/ports/MediaCache'
import { PortsProvider } from '@/ui/PortsProvider'
import { Home } from '@/ui/screens/Home'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * La langue est forcée : le détecteur lit `navigator.language`, qui vaut
 * `en-US` sous jsdom. Sans ça le rendu part en anglais, les assertions
 * françaises échouent, et l'échec ressemble à un défaut des compteurs alors
 * qu'il ne dit rien d'eux.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

/**
 * Compteurs de l'accueil.
 *
 * Ce test existe à cause d'un défaut réel : les compteurs ont été écrits en
 * dur à `0` en attendant les sections de l'étape 8. Tant qu'aucun écran ne
 * montre la bibliothèque, cette ligne est le **seul** retour visible après un
 * ajout — et un `0` faux fait diagnostiquer une perte de données qui n'existe
 * pas. Un placeholder qui se tait est honnête ; un compteur faux ne l'est pas.
 *
 * L'assertion porte donc sur des nombres non nuls et distincts entre eux : un
 * retour aux valeurs en dur, ou une inversion des deux compteurs, échoue ici.
 */
function renderHome(mediaStates: readonly MediaStateRow[]) {
  return render(
    <PortsProvider ports={fakePorts({ mediaStates })}>
      <Home firstName="Tx" />
    </PortsProvider>,
  )
}

describe('compteurs de l accueil', () => {
  it('compte les titres du store, pas des zeros en dur', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    const states = [
      mediaState([f1.watch(), f1.start('c1')], MOVIE),
      mediaState([f2.watch()], SERIES),
    ]

    renderHome(states)

    expect(screen.getByText('› 1 en cours · 1 à voir')).toBeDefined()
  })

  it('ne confond pas en cours et a voir', () => {
    const f1 = createFactory(MOVIE)
    const f2 = createFactory(SERIES)

    // Deux « à voir » pour un « en cours » : si les deux compteurs sont
    // intervertis, le rendu dit « 2 en cours · 1 à voir » et le test tombe.
    const states = [
      mediaState([f1.watch(), f1.start('c1')], MOVIE),
      mediaState([f2.watch()], SERIES),
      mediaState([createFactory('tmdb:movie/603').watch()], 'tmdb:movie/603'),
    ]

    renderHome(states)

    expect(screen.getByText('› 1 en cours · 2 à voir')).toBeDefined()
  })

  it('rend zero quand la bibliotheque est vide', () => {
    renderHome([])

    expect(screen.getByText('› 0 en cours · 0 à voir')).toBeDefined()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Série de dix épisodes, en cours, sans progression écrite. */
function watchingSeries(): {
  events: readonly StoredEvent[]
  state: MediaStateRow
  cache: MediaCacheRow
} {
  const f = createFactory(SERIES)
  const events = [f.watch(), f.start('c1'), f.prog('c1', 0, { label: 'S01E01' })]

  return {
    events,
    state: mediaState(events, SERIES),
    cache: {
      ...partialCacheRow(
        { ref: SERIES, kind: 'tv', title: 'Severance', year: 2022, posterPath: null },
        '2026-01-01T00:00:00.000Z',
      ),
      numberOfEpisodes: 10,
    },
  }
}

/** Film en cours : le play adaptatif doit marquer vu, pas faire progresser. */
function watchingMovie(): {
  events: readonly StoredEvent[]
  state: MediaStateRow
  cache: MediaCacheRow
} {
  const f = createFactory(MOVIE)
  const events = [f.watch(), f.start('c1')]

  return {
    events,
    state: mediaState(events, MOVIE),
    cache: partialCacheRow(
      { ref: MOVIE, kind: 'movie', title: 'Dune', year: 2021, posterPath: null },
      '2026-01-01T00:00:00.000Z',
    ),
  }
}

/**
 * Bouton play.
 *
 * C'est le critère de réussite de l'étape 8, tel que le document de design
 * l'énonce : « sur une série de 10 épisodes, un tap avance d'un épisode et le
 * label suit ». Le vérifier à la main une fois ne dit rien du jour où
 * l'incrément ou le regroupement bougent.
 */
describe('bouton play', () => {
  it('avance d un episode et fait suivre le label, tout de suite', () => {
    const { events, state, cache } = watchingSeries()

    render(
      <PortsProvider ports={fakePorts({ mediaStates: [state], mediaEvents: events, mediaCache: [cache] })}>
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    expect(screen.getByText('S01E01 · 0%')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Avancer Severance'))

    // Dix episodes font dix points, et le label passe a l'episode suivant
    // sans attendre l'ecriture : c'est la moitie « affichage » de la regle.
    expect(screen.getByText('S01E02 · 10%')).toBeDefined()
  })

  it('regroupe une rafale de taps en un seul PROG', async () => {
    vi.useFakeTimers()
    const { events, state, cache } = watchingSeries()
    const appended: StoredEvent[][] = []

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [state],
          mediaEvents: events,
          mediaCache: [cache],
          onAppend: (produced) => appended.push([...produced]),
        })}
      >
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    const play = screen.getByLabelText('Avancer Severance')
    fireEvent.click(play)
    fireEvent.click(play)
    fireEvent.click(play)

    expect(screen.getByText('S01E04 · 30%')).toBeDefined()
    // Rien n'est encore ecrit : c'est le point de la regle. Trois evenements
    // pour une rafale rendraient le journal illisible.
    expect(appended).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000)

    expect(appended).toHaveLength(1)
    const produced = appended[0] ?? []
    // `flatMap` plutôt que `filter` : c'est ce qui restreint le type au
    // variant `PROG`, donc ce qui donne accès à `payload` sans transtypage.
    const progs = produced.flatMap((event) => (event.type === 'PROG' ? [event] : []))

    expect(progs).toHaveLength(1)
    expect(progs[0]?.payload).toMatchObject({ percent: 30, label: 'S01E04' })
  })

  it('marque vu un film au tap, sans écrire de progression', async () => {
    const { events, state, cache } = watchingMovie()
    const appended: StoredEvent[][] = []

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [state],
          mediaEvents: events,
          mediaCache: [cache],
          onAppend: (produced) => appended.push([...produced]),
        })}
      >
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    // Le libellé accessible dit le geste réel : marquer vu, pas avancer.
    fireEvent.click(screen.getByLabelText('Marquer Dune vu'))

    // Pas de regroupement pour un film : un seul événement possible, il
    // s'écrit tout de suite — et c'est un SEEN, jamais un PROG.
    await waitFor(() => expect(appended).toHaveLength(1))
    const produced = appended[0] ?? []
    expect(produced.filter((event) => event.type === 'SEEN')).toHaveLength(1)
    expect(produced.filter((event) => event.type === 'PROG')).toHaveLength(0)
  })

  it('absorbe le double-tap sur un film : une seule écriture', async () => {
    const { events, state, cache } = watchingMovie()
    const appended: StoredEvent[][] = []

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [state],
          mediaEvents: events,
          mediaCache: [cache],
          onAppend: (produced) => appended.push([...produced]),
        })}
      >
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    const play = screen.getByLabelText('Marquer Dune vu')
    fireEvent.click(play)
    fireEvent.click(play)

    await waitFor(() => expect(appended).toHaveLength(1))
    // Laisse retomber les microtâches : une seconde écriture tardive doit
    // apparaître ici, pas passer entre deux assertions.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(appended).toHaveLength(1)
    expect((appended[0] ?? []).filter((event) => event.type === 'SEEN')).toHaveLength(1)
  })

  it('affiche le rang deduit quand aucun label n a ete saisi', () => {
    const f = createFactory(SERIES)
    const events = [f.watch(), f.start('c1'), f.prog('c1', 30)]
    const { cache } = watchingSeries()
    const state = mediaState(events, SERIES)

    render(
      <PortsProvider ports={fakePorts({ mediaStates: [state], mediaEvents: events, mediaCache: [cache] })}>
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    // Sans label saisi, la saison est inconnue — pas de `S01E03` inventé —
    // mais 30 % de dix épisodes se lisent « ép. 3/10 ».
    expect(screen.getByText('ép. 3/10 · 30%')).toBeDefined()
  })

  it('clot le cycle au dixieme tap, sans toucher au statut a la main', async () => {
    vi.useFakeTimers()
    const { events, state, cache } = watchingSeries()
    const appended: StoredEvent[][] = []

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [state],
          mediaEvents: events,
          mediaCache: [cache],
          onAppend: (produced) => appended.push([...produced]),
        })}
      >
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    const play = screen.getByLabelText('Avancer Severance')
    for (let tap = 0; tap < 10; tap += 1) fireEvent.click(play)

    // S01E10 et non S01E11 : le dixieme tap clot le cycle, il ne designe pas
    // un onzieme episode qui n'existe pas.
    expect(screen.getByText('S01E10 · 100%')).toBeDefined()

    await vi.advanceTimersByTimeAsync(2000)

    // Un `PROG` a 100 emet un `SEEN` : le play mene a « vu » sans que
    // personne n'ait touche a la pastille.
    const produced = appended[0] ?? []
    expect(produced.filter((event) => event.type === 'SEEN')).toHaveLength(1)
  })
})

/**
 * Play discret de l'étagère « À VOIR ».
 *
 * Un tap sur le ▶ superposé à l'affiche fait passer le titre « en cours »
 * sans ouvrir la fiche. Le geste vit sur l'accueil seulement, jamais en
 * Bibliothèque (décision D2.3).
 */
describe('play de l etagere a voir', () => {
  function toWatchSeries(): {
    events: readonly StoredEvent[]
    state: MediaStateRow
    cache: MediaCacheRow
  } {
    const f = createFactory(SERIES)
    const events = [f.watch()]

    return {
      events,
      state: mediaState(events, SERIES),
      cache: partialCacheRow(
        { ref: SERIES, kind: 'tv', title: 'Severance', year: 2022, posterPath: null },
        '2026-01-01T00:00:00.000Z',
      ),
    }
  }

  it('un tap ouvre un cycle : le titre passe en cours', async () => {
    const { events, state, cache } = toWatchSeries()
    const appended: StoredEvent[][] = []

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [state],
          mediaEvents: events,
          mediaCache: [cache],
          onAppend: (produced) => appended.push([...produced]),
        })}
      >
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    fireEvent.click(screen.getByLabelText('Commencer Severance'))

    // Le titre est déjà en bibliothèque : le geste n'écrit qu'un `START`,
    // jamais un second `WATCH`.
    await waitFor(() => expect(appended).toHaveLength(1))
    const produced = appended[0] ?? []
    expect(produced.filter((event) => event.type === 'START')).toHaveLength(1)
    expect(produced.filter((event) => event.type === 'WATCH')).toHaveLength(0)
  })

  it('absorbe le double-tap : une seule écriture', async () => {
    const { events, state, cache } = toWatchSeries()
    const appended: StoredEvent[][] = []

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [state],
          mediaEvents: events,
          mediaCache: [cache],
          onAppend: (produced) => appended.push([...produced]),
        })}
      >
        <Home firstName="Tx" />
      </PortsProvider>,
    )

    const play = screen.getByLabelText('Commencer Severance')
    fireEvent.click(play)
    fireEvent.click(play)

    await waitFor(() => expect(appended).toHaveLength(1))
    // Laisse retomber les microtâches : une seconde écriture tardive doit
    // apparaître ici, pas passer entre deux assertions.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(appended).toHaveLength(1)
  })
})
