import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SeasonDetail } from '@owlog/contracts'
import { mediaState, type StoredEvent } from '@owlog/domain'
import { createFactory, MOVIE, SERIES } from '@owlog/domain/test'
import i18next from '@/i18n'
import { MEDIA_CACHE_STALE_MS, completeCacheRow, partialCacheRow } from '@/ports/MediaCache'
import { PortsProvider, type Ports } from '@/ui/PortsProvider'
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
  /** Compte de saisons du cache. `null` (inconnu) par défaut. */
  numberOfSeasons?: number | null
  /** Ce que `catalog.season` répond. Absent : hors-ligne. */
  seasonDetail?: SeasonDetail
}

/**
 * L'arbre réel : les ports et le client TanStack Query. Un client neuf par
 * rendu — un cache partagé entre tests ferait passer le second pour la
 * mauvaise raison.
 */
function renderScreen(ports: Ports, ref: typeof MOVIE | typeof SERIES) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PortsProvider ports={ports}>
        <Media ref={ref} />
      </PortsProvider>
    </QueryClientProvider>,
  )
}

function renderMedia(events: readonly StoredEvent[], options: RenderOptions = {}) {
  return renderScreen(
    fakePorts({
      mediaEvents: events,
      mediaStates: [mediaState(events, MOVIE)],
      mediaCache: [partialCacheRow(HIT, 'now')],
      ...(options.onAppend === undefined ? {} : { onAppend: options.onAppend }),
    }),
    MOVIE,
  )
}

/** Série de dix épisodes : l'incrément d'un tap vaut dix points. */
function renderSeries(events: readonly StoredEvent[], options: RenderOptions = {}) {
  return renderScreen(
    fakePorts({
      mediaEvents: events,
      mediaStates: [mediaState(events, SERIES)],
      mediaCache: [
        {
          ...partialCacheRow(SERIES_HIT, 'now'),
          numberOfEpisodes: options.numberOfEpisodes === undefined ? 10 : options.numberOfEpisodes,
          ...(options.numberOfSeasons === undefined
            ? {}
            : { numberOfSeasons: options.numberOfSeasons }),
        },
      ],
      ...(options.seasonDetail === undefined ? {} : { seasonDetail: options.seasonDetail }),
      ...(options.onAppend === undefined ? {} : { onAppend: options.onAppend }),
    }),
    SERIES,
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
      <QueryClientProvider client={new QueryClient()}>
        <PortsProvider
          ports={fakePorts({ mediaCache: [completeCacheRow(DETAIL, fetchedAt)], detail })}
        >
          <Media ref={MOVIE} />
        </PortsProvider>
      </QueryClientProvider>,
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
 * Ligne synthétique du journal — arbitrage utilisateur (option A).
 *
 * Les PROG restent exclus du journal ; le dernier épisode vu du cycle en
 * cours se lit sur une ligne dérivée, jamais une par épisode.
 */
describe('dernier épisode vu au journal', () => {
  it('affiche le label du cycle en cours', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1'), f.prog('c1', 10, { label: 'S02E05' })] as StoredEvent[])

    expect(await screen.findByText('dernier épisode vu · S02E05')).toBeDefined()
  })

  it('déduit le rang quand aucun label n existe', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1'), f.prog('c1', 30)] as StoredEvent[])

    expect(await screen.findByText('dernier épisode vu · ép. 3/10')).toBeDefined()
  })

  it('se tait sur un titre vu', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[])

    await screen.findByText('Dune')
    expect(screen.queryByText(/dernier épisode vu/)).toBeNull()
  })
})

/**
 * Encart saisons/épisodes, à droite du titre.
 *
 * Il n'affiche que ce qui est connu : les lignes de cache écrites avant
 * `numberOfSeasons` n'ont que le compte d'épisodes, et un film n'a rien.
 */
describe('encart saisons/épisodes', () => {
  /** La ligne de l'encart : chiffre et mot vivent dans deux spans. */
  function tileLine(count: number, word: string) {
    return screen.findByText(
      (_, element) =>
        element?.tagName === 'P' && element.textContent === `${count} ${word}`,
    )
  }

  it('affiche saisons et épisodes quand le cache les connaît', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch()] as StoredEvent[], { numberOfSeasons: 2 })

    expect(await tileLine(2, 'saisons')).toBeDefined()
    expect(await tileLine(10, 'épisodes')).toBeDefined()
  })

  it('accorde le singulier', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch()] as StoredEvent[], { numberOfSeasons: 1, numberOfEpisodes: 1 })

    expect(await tileLine(1, 'saison')).toBeDefined()
    expect(await tileLine(1, 'épisode')).toBeDefined()
  })

  it('n affiche que les épisodes quand le compte de saisons manque', async () => {
    // C'est la ligne de cache d'avant ce champ : elle ne se répare qu'à la
    // prochaine ouverture en ligne, et l'encart doit vivre sans elle.
    const f = createFactory(SERIES)
    renderSeries([f.watch()] as StoredEvent[])

    expect(await tileLine(10, 'épisodes')).toBeDefined()
    expect(screen.queryByText('saisons')).toBeNull()
  })

  it('disparaît quand rien n est connu', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch()] as StoredEvent[], { numberOfEpisodes: null })

    await screen.findByText('Severance')
    expect(screen.queryByText('épisodes')).toBeNull()
    expect(screen.queryByText('saisons')).toBeNull()
  })

  it('reste muet sur un film', async () => {
    const f = createFactory()
    renderMedia([f.watch()] as StoredEvent[])

    await screen.findByText('Dune')
    expect(screen.queryByText('saisons')).toBeNull()
    expect(screen.queryByText('épisodes')).toBeNull()
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
 * Titre de l'épisode suivant, sous le CTA.
 *
 * La règle d'accès est celle du domaine (`upcomingEpisodeRank`) : saison
 * sue par le label, ou saison unique. Ici se vérifie le reste — l'appel au
 * catalogue, l'affichage, et surtout le silence sur tout ce qui manque.
 */
describe('titre de l’épisode suivant', () => {
  const SEASON_TWO: SeasonDetail = {
    seasonNumber: 2,
    episodes: [
      { episodeNumber: 5, name: 'La balise' },
      { episodeNumber: 6, name: 'Le retour' },
    ],
  }

  it('affiche le titre quand le label dit la saison', async () => {
    const f = createFactory(SERIES)
    renderSeries(
      [f.watch(), f.start('c1'), f.prog('c1', 10, { label: 'S02E05' })] as StoredEvent[],
      { seasonDetail: SEASON_TWO },
    )

    expect(await screen.findByText('« Le retour »')).toBeDefined()
  })

  it('affiche le titre d un rang déduit quand la série n a qu une saison', async () => {
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1')] as StoredEvent[], {
      numberOfSeasons: 1,
      seasonDetail: {
        seasonNumber: 1,
        episodes: [{ episodeNumber: 1, name: 'Pilote' }],
      },
    })

    expect(await screen.findByText('« Pilote »')).toBeDefined()
  })

  it('se tait sur un rang déduit quand la série a plusieurs saisons', async () => {
    // La saison n'a jamais été dite : deviner « saison 1 » afficherait le
    // titre d'un autre épisode que celui qu'on regarde.
    const f = createFactory(SERIES)
    renderSeries([f.watch(), f.start('c1')] as StoredEvent[], {
      numberOfSeasons: 3,
      seasonDetail: SEASON_TWO,
    })

    expect(await screen.findByText('ÉPISODE SUIVANT · ÉP. 1')).toBeDefined()
    expect(screen.queryByText(/^« .+ »$/)).toBeNull()
  })

  it('se tait hors-ligne, sans placeholder', async () => {
    // `seasonDetail` absent : le catalogue répond hors-ligne. Le CTA reste
    // entier, la ligne de titre n'existe pas — jamais un « … » bruyant.
    const f = createFactory(SERIES)
    renderSeries(
      [f.watch(), f.start('c1'), f.prog('c1', 10, { label: 'S02E05' })] as StoredEvent[],
    )

    expect(await screen.findByText('ÉPISODE SUIVANT S02E06')).toBeDefined()
    expect(screen.queryByText(/^« .+ »$/)).toBeNull()
  })

  it('se tait quand l épisode manque à la saison', async () => {
    const f = createFactory(SERIES)
    renderSeries(
      [f.watch(), f.start('c1'), f.prog('c1', 10, { label: 'S02E09' })] as StoredEvent[],
      { seasonDetail: SEASON_TWO },
    )

    expect(await screen.findByText('ÉPISODE SUIVANT S02E10')).toBeDefined()
    expect(screen.queryByText(/^« .+ »$/)).toBeNull()
  })
})

/**
 * Bouton `⋯` du backdrop : le choix direct de statut, sans appui long.
 *
 * C'est la même feuille que la bibliothèque — aucune surface inventée — et
 * le même garde-fou : choisir un statut écrit un événement, fermer n'écrit
 * rien.
 */
describe('menu de statut de la fiche', () => {
  it('ouvre la feuille de choix direct', async () => {
    const f = createFactory()
    renderMedia([f.watch()] as StoredEvent[])

    fireEvent.click(await screen.findByLabelText('options de statut'))

    expect(screen.getByText('choisir directement un statut')).toBeDefined()
  })

  it('choisir un statut écrit l événement et referme la feuille', async () => {
    const f = createFactory()
    const appended: StoredEvent[][] = []
    renderMedia([f.watch()] as StoredEvent[], {
      onAppend: (produced) => appended.push([...produced]),
    })

    fireEvent.click(await screen.findByLabelText('options de statut'))
    // La feuille repose sur les mêmes libellés que les chips de la page :
    // le geste se cible dans la section du menu, pas dans tout l'écran.
    const sheet = screen.getByText('choisir directement un statut').closest('section')
    fireEvent.click(within(sheet as HTMLElement).getByRole('button', { name: /en cours/ }))

    await waitFor(() => expect(appended).toHaveLength(1))
    expect((appended[0] ?? []).some((event) => event.type === 'START')).toBe(true)
    expect(screen.queryByText('choisir directement un statut')).toBeNull()
  })

  it('fermer la feuille n écrit rien', async () => {
    const f = createFactory()
    const appended: StoredEvent[][] = []
    renderMedia([f.watch()] as StoredEvent[], {
      onAppend: (produced) => appended.push([...produced]),
    })

    fireEvent.click(await screen.findByLabelText('options de statut'))
    fireEvent.click(screen.getByLabelText('fermer'))

    expect(screen.queryByText('choisir directement un statut')).toBeNull()
    expect(appended).toHaveLength(0)
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
