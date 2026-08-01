import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { mediaState, type StoredEvent } from '@owlog/domain'
import { createFactory, MOVIE, SERIES } from '@owlog/domain/test'
import i18next from '@/i18n'
import { MEDIA_CACHE_STALE_MS, completeCacheRow, partialCacheRow } from '@/ports/MediaCache'
import { PortsProvider } from '@/ui/PortsProvider'
import { Media } from '@/ui/screens/Media'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Page média.
 *
 * L'écran est la vitrine du modèle : titre depuis le cache (donc lisible
 * hors-ligne), statut depuis la ligne dérivée, journal groupé par
 * marqueurs de visionnage, et un **CTA plein unique, exclusif par statut** —
 * REVOIR sur un titre vu, épisode suivant ou marquer vu sur un titre en
 * cours selon que le média a des épisodes, rien ailleurs.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

afterEach(() => {
  vi.useRealTimers()
})

const HIT = {
  ref: MOVIE,
  kind: 'movie' as const,
  title: 'Dune',
  year: 2021,
  posterPath: null,
}

const SERIES_HIT = {
  ref: SERIES,
  kind: 'tv' as const,
  title: 'Severance',
  year: 2022,
  posterPath: null,
}

interface RenderOptions {
  onAppend?: (produced: readonly StoredEvent[]) => void
  /** Compte d'épisodes du cache. Dix par défaut, `null` pour l'inconnu. */
  numberOfEpisodes?: number | null
}

function renderMedia(events: readonly StoredEvent[], options: RenderOptions = {}) {
  return render(
    <PortsProvider
      ports={fakePorts({
        mediaEvents: events,
        mediaStates: [mediaState(events, MOVIE)],
        mediaCache: [partialCacheRow(HIT, 'now')],
        ...(options.onAppend === undefined ? {} : { onAppend: options.onAppend }),
      })}
    >
      <Media ref={MOVIE} />
    </PortsProvider>,
  )
}

/** Série de dix épisodes : l'incrément d'un tap vaut dix points. */
function renderSeries(events: readonly StoredEvent[], options: RenderOptions = {}) {
  return render(
    <PortsProvider
      ports={fakePorts({
        mediaEvents: events,
        mediaStates: [mediaState(events, SERIES)],
        mediaCache: [
          {
            ...partialCacheRow(SERIES_HIT, 'now'),
            numberOfEpisodes: options.numberOfEpisodes === undefined ? 10 : options.numberOfEpisodes,
          },
        ],
        ...(options.onAppend === undefined ? {} : { onAppend: options.onAppend }),
      })}
    >
      <Media ref={SERIES} />
    </PortsProvider>,
  )
}

describe('Media', () => {
  it('rend le titre du cache et le journal groupé par visionnage', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[])

    expect(await screen.findByText('Dune')).toBeDefined()
    expect(screen.getByText('— visionnage #1 —')).toBeDefined()
  })

  it('un journal vide le dit, sans casser la page', async () => {
    renderMedia([])

    expect(
      await screen.findByText('rien encore. le premier geste écrira la première ligne.'),
    ).toBeDefined()
  })
})

/**
 * Rafraîchissement de `media_cache` à l'ouverture de la fiche.
 *
 * La règle elle-même est testée sur `isCacheRowStale` ; ici on affirme le
 * câblage — une fiche dont le cache est frais ne touche pas au réseau, une
 * fiche périmée le rafraîchit. C'est ce qui garantit qu'une session normale
 * s'ouvre sans un seul appel `/media/:ref`.
 */
describe('fraîcheur du cache média', () => {
  const DETAIL = {
    ref: MOVIE,
    kind: 'movie' as const,
    title: 'Dune',
    year: 2021,
    posterPath: null,
    backdropPath: null,
    genres: ['Science-Fiction'],
    totalRuntime: 155,
    numberOfEpisodes: null,
    overview: '',
    externalRatings: { tmdb: 7.8 },
  }

  function renderWithFetchedAt(fetchedAt: string) {
    const detail = vi.fn(() =>
      Promise.resolve({ ok: false as const, failure: { kind: 'offline' as const } }),
    )

    render(
      <PortsProvider
        ports={fakePorts({ mediaCache: [completeCacheRow(DETAIL, fetchedAt)], detail })}
      >
        <Media ref={MOVIE} />
      </PortsProvider>,
    )

    return detail
  }

  it('une ligne complète et fraîche ne déclenche aucun appel réseau', async () => {
    const detail = renderWithFetchedAt(new Date().toISOString())

    expect(await screen.findByText('Dune')).toBeDefined()
    expect(detail).not.toHaveBeenCalled()
  })

  it('une ligne complète mais périmée se rafraîchit', async () => {
    const stale = new Date(Date.now() - MEDIA_CACHE_STALE_MS - 60_000).toISOString()
    const detail = renderWithFetchedAt(stale)

    await waitFor(() => expect(detail).toHaveBeenCalledOnce())
  })
})

/**
 * CTA plein unique, exclusif par statut.
 *
 * La décision de gate est stricte : « vu » propose REVOIR, « en cours »
 * propose le geste du play adaptatif, tout autre statut n'a **aucun** CTA
 * plein — et jamais deux à la fois. Chaque test affirme donc autant
 * l'absence des deux autres que la présence du bon.
 */
describe('CTA de la fiche', () => {
  it('un titre vu propose REVOIR, avec le numéro du prochain visionnage', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[])

    expect(await screen.findByText('REVOIR')).toBeDefined()
    expect(screen.getByText(/ouvre le visionnage #2/)).toBeDefined()
    expect(screen.queryByText('MARQUER VU')).toBeNull()
    expect(screen.queryByText(/ÉPISODE SUIVANT/)).toBeNull()
  })

  it('un film en cours propose MARQUER VU, et lui seul', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1')] as StoredEvent[])

    expect(await screen.findByText('MARQUER VU')).toBeDefined()
    expect(screen.queryByText('REVOIR')).toBeNull()
    expect(screen.queryByText(/ÉPISODE SUIVANT/)).toBeNull()
  })

  it('une série en cours propose l épisode qui suit la progression', async () => {
    const f = createFactory(SERIES)
    renderSeries([
      f.watch(),
      f.start('c1'),
      f.prog('c1', 10, { label: 'S02E05' }),
    ] as StoredEvent[])

    expect(await screen.findByText('ÉPISODE SUIVANT S02E06')).toBeDefined()
    expect(screen.queryByText('REVOIR')).toBeNull()
    expect(screen.queryByText('MARQUER VU')).toBeNull()
  })

  it('une série sans label porte le rang déduit du compte d épisodes', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1')] as StoredEvent[])

    // Sans label existant, la saison est inconnue — pas de `S01E01` inventé —
    // mais le rang, lui, se déduit du pourcentage et du compte d'épisodes :
    // à 0 % d'une série de dix, le prochain épisode est le premier.
    expect(await screen.findByText('ÉPISODE SUIVANT · ÉP. 1')).toBeDefined()
  })

  it('le rang déduit suit la progression', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1'), f.prog('c1', 30)] as StoredEvent[])

    // 30 % de dix épisodes font trois épisodes vus : le prochain est le
    // quatrième, sans que personne n'ait jamais saisi de label.
    expect(await screen.findByText('ÉPISODE SUIVANT · ÉP. 4')).toBeDefined()
  })

  it('une série sans label ni compte d épisodes reste utilisable', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1')] as StoredEvent[], { numberOfEpisodes: null })

    // Sans label ni compte, on ne sait rien : le CTA se tait plutôt que
    // d'affirmer un épisode que personne n'a dit.
    expect(await screen.findByText('ÉPISODE SUIVANT')).toBeDefined()
  })

  it('un titre à voir n a aucun CTA plein', async () => {
    const f = createFactory()
    renderMedia([f.watch()] as StoredEvent[])

    await screen.findByText('Dune')
    expect(screen.queryByText('REVOIR')).toBeNull()
    expect(screen.queryByText('MARQUER VU')).toBeNull()
    expect(screen.queryByText(/ÉPISODE SUIVANT/)).toBeNull()
  })

  it('un titre abandonné n a aucun CTA plein', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1'), f.drop('c1')] as StoredEvent[])

    await screen.findByText('Dune')
    expect(screen.queryByText('REVOIR')).toBeNull()
    expect(screen.queryByText('MARQUER VU')).toBeNull()
    expect(screen.queryByText(/ÉPISODE SUIVANT/)).toBeNull()
  })
})

/**
 * Barre de progression de la fiche.
 *
 * La même barre que l'accueil, sous la ligne de note : elle ne s'affiche que
 * sur un titre en cours qui a réellement avancé — à 0 % ou sur tout autre
 * statut elle n'apprend rien que les chips ne disent déjà.
 */
describe('barre de progression de la fiche', () => {
  it('affiche l avancement d une série en cours', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1'), f.prog('c1', 30)] as StoredEvent[])

    const bar = await screen.findByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('30')
  })

  it('se tait à zéro pour cent', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1')] as StoredEvent[])

    await screen.findByText('Severance')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('se tait sur un titre qui n est pas en cours', async () => {
    const f = createFactory()
    renderMedia([f.watch()] as StoredEvent[])

    await screen.findByText('Dune')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

describe('gestes du CTA', () => {
  it('MARQUER VU écrit un SEEN, jamais un PROG', async () => {
    const f = createFactory()
    const appended: StoredEvent[][] = []
    renderMedia([f.watch(), f.start('c1')] as StoredEvent[], {
      onAppend: (produced) => appended.push([...produced]),
    })

    fireEvent.click(await screen.findByText('MARQUER VU'))

    await waitFor(() => expect(appended).toHaveLength(1))
    const produced = appended[0] ?? []
    expect(produced.filter((event) => event.type === 'SEEN')).toHaveLength(1)
    expect(produced.filter((event) => event.type === 'PROG')).toHaveLength(0)
  })

  it('absorbe le double-tap sur MARQUER VU : une seule écriture', async () => {
    const f = createFactory()
    const appended: StoredEvent[][] = []
    renderMedia([f.watch(), f.start('c1')] as StoredEvent[], {
      onAppend: (produced) => appended.push([...produced]),
    })

    const cta = await screen.findByText('MARQUER VU')
    fireEvent.click(cta)
    fireEvent.click(cta)

    await waitFor(() => expect(appended).toHaveLength(1))
    // Laisse retomber les microtâches : une seconde écriture tardive doit
    // se voir ici, pas passer entre deux assertions.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(appended).toHaveLength(1)
    expect((appended[0] ?? []).filter((event) => event.type === 'SEEN')).toHaveLength(1)
  })

  it('ÉPISODE SUIVANT avance l affichage tout de suite et regroupe l écriture', async () => {
    vi.useFakeTimers()
    const f = createFactory(SERIES)
    const appended: StoredEvent[][] = []
    renderSeries(
      [f.watch(), f.start('c1'), f.prog('c1', 10, { label: 'S02E05' })] as StoredEvent[],
      { onAppend: (produced) => appended.push([...produced]) },
    )

    fireEvent.click(screen.getByText('ÉPISODE SUIVANT S02E06'))

    // L'affichage suit le tap sans attendre l'écriture : le CTA désigne
    // maintenant l'épisode d'après, et rien n'est encore écrit.
    expect(screen.getByText('ÉPISODE SUIVANT S02E07')).toBeDefined()
    expect(appended).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2000)

    expect(appended).toHaveLength(1)
    const progs = (appended[0] ?? []).flatMap((event) => (event.type === 'PROG' ? [event] : []))
    expect(progs).toHaveLength(1)
    expect(progs[0]?.payload).toMatchObject({ percent: 20, label: 'S02E06' })
  })
})
