import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { mediaState, type MediaStateRow } from '@/domain/reducers/mediaState'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'
import type { StoredEvent } from '@/domain/types'
import i18next from '@/i18n'
import { partialCacheRow, type MediaCacheRow } from '@/ports/MediaCache'
import { PortsProvider } from '@/ui/PortsProvider'
import { Library } from '@/ui/screens/Library'
import { fakePorts } from '@/ui/test/fakePorts'

beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

afterEach(() => {
  vi.useRealTimers()
})

/** Durée de l'appui long, `useLongPress`. */
const HOLD_MS = 550

const CACHE: readonly MediaCacheRow[] = [
  partialCacheRow(
    { ref: MOVIE, kind: 'movie', title: 'Dune', year: 2021, posterPath: null },
    '2026-01-01T00:00:00.000Z',
  ),
  partialCacheRow(
    { ref: SERIES, kind: 'tv', title: 'Severance', year: 2022, posterPath: null },
    '2026-01-01T00:00:00.000Z',
  ),
]

function renderLibrary(
  states: readonly MediaStateRow[],
  options: { events?: readonly StoredEvent[]; onAppend?: (e: readonly StoredEvent[]) => void } = {},
) {
  return render(
    <PortsProvider
      ports={fakePorts({
        mediaStates: states,
        mediaCache: CACHE,
        ...(options.events ? { mediaEvents: options.events } : {}),
        ...(options.onAppend ? { onAppend: options.onAppend } : {}),
      })}
    >
      <Library />
    </PortsProvider>,
  )
}

/**
 * Critère d'acceptation de l'étape 10, tel que le document de design
 * l'énonce : « les compteurs correspondent, le cycle boucle, l'appui long
 * permet `à voir → abandonné` en une action ».
 */
describe('bibliotheque', () => {
  it('accorde le compteur d une chip avec la liste qu elle ouvre', () => {
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    renderLibrary([
      mediaState([film.watch()], MOVIE),
      mediaState([serie.watch(), serie.start('c1')], SERIES),
    ])

    // Une chip qui annonce un nombre au-dessus d'une liste qui en montre un
    // autre ne se lit pas comme un defaut d'affichage mais comme une perte
    // de donnees. C'est ce que ce test interdit.
    fireEvent.click(screen.getByText('● en cours · 1'))

    expect(screen.getByText('Severance')).toBeDefined()
    expect(screen.queryByText('Dune')).toBeNull()
  })

  it('fait tourner le statut d un cran au tap sur la pastille', async () => {
    const film = createFactory(MOVIE)
    const events = [film.watch()]
    const appended: StoredEvent[][] = []

    renderLibrary([mediaState(events, MOVIE)], {
      events,
      onAppend: (produced) => appended.push([...produced]),
    })

    fireEvent.click(screen.getByLabelText(/Statut de Dune/))
    await vi.waitFor(() => expect(appended).toHaveLength(1))

    // « a voir » suivant, c'est « en cours » : un START qui ouvre un cycle.
    expect(appended[0]?.map((event) => event.type)).toEqual(['START'])
  })

  it('n avance pas le statut quand l appui long ouvre le menu', async () => {
    vi.useFakeTimers()
    const film = createFactory(MOVIE)
    const events = [film.watch()]
    const appended: StoredEvent[][] = []

    renderLibrary([mediaState(events, MOVIE)], {
      events,
      onAppend: (produced) => appended.push([...produced]),
    })

    const pill = screen.getByLabelText(/Statut de Dune/)

    // Le geste reel : on presse, le menu s'ouvre au bout du delai, on releve
    // — et le navigateur emet un click. Sans garde, ce click ferait tourner
    // le statut par-dessus le menu, donc ecrirait un evenement definitif
    // que personne n'a demande.
    fireEvent.pointerDown(pill)
    // `act` parce que la minuterie change un etat React hors du flux de
    // rendu : sans elle, le menu s'ouvre dans le composant mais l'arbre
    // rendu n'est pas remis a jour avant l'assertion.
    await act(() => vi.advanceTimersByTimeAsync(HOLD_MS))
    fireEvent.pointerUp(pill)
    fireEvent.click(pill)

    expect(screen.getByText('choisir directement un statut')).toBeDefined()
    expect(appended).toHaveLength(0)
  })

  it('mene de « a voir » a « abandonne » en une action', async () => {
    vi.useFakeTimers()
    const film = createFactory(MOVIE)
    const events = [film.watch()]
    const appended: StoredEvent[][] = []

    renderLibrary([mediaState(events, MOVIE)], {
      events,
      onAppend: (produced) => appended.push([...produced]),
    })

    const pill = screen.getByLabelText(/Statut de Dune/)
    fireEvent.pointerDown(pill)
    // `act` parce que la minuterie change un etat React hors du flux de
    // rendu : sans elle, le menu s'ouvre dans le composant mais l'arbre
    // rendu n'est pas remis a jour avant l'assertion.
    await act(() => vi.advanceTimersByTimeAsync(HOLD_MS))
    fireEvent.pointerUp(pill)

    fireEvent.click(screen.getByText('abandonné'))
    await vi.waitFor(() => expect(appended).toHaveLength(1))

    // Une seule ecriture, et elle porte le cycle ouvert **et** son abandon.
    // Trois taps sur la pastille auraient produit trois ecritures, dont deux
    // decrivant un visionnage que personne n'a vecu.
    expect(appended[0]?.map((event) => event.type)).toEqual(['START', 'DROP'])
  })
})
