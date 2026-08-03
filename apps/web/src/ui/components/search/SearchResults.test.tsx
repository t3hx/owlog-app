import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import type { SearchHit } from '@owlog/contracts'

import type { StoredEvent } from '@owlog/domain'
import { MOVIE } from '@owlog/domain/test'
import i18next from '@/i18n'
import { PortsProvider } from '@/ui/PortsProvider'
import { SearchResults } from '@/ui/components/search/SearchResults'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Gestes rapides des résultats de recherche.
 *
 * Trois boutons sur une rangée neuve, un lot d'événements chacun : `+` ajoute
 * en « à voir » (`WATCH`), ♥ ajoute en **« vu » daté du jour** et marque le
 * coup de cœur (décision utilisateur : un coup de cœur est un titre déjà vu
 * — cycle complet + `FAV`, jamais `FAV` seul), ▶ ajoute directement
 * « en cours » (`WATCH` + `START`).
 *
 * Les assertions portent sur les événements écrits, pas sur les pixels :
 * c'est le contenu du lot qui est la règle, et il s'écrit pour toujours.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

const HIT: SearchHit = {
  ref: MOVIE,
  kind: 'movie',
  title: 'Dune',
  year: 2021,
  posterPath: null,
}

function renderResults(onAppend: (produced: readonly StoredEvent[]) => void) {
  return render(
    <PortsProvider ports={fakePorts({ onAppend })}>
      <SearchResults
        state={{ status: 'done', hits: [HIT] }}
        scope="all"
        query="dune"
        onSetAside={() => undefined}
        onRetry={() => undefined}
      />
    </PortsProvider>,
  )
}

describe('gestes rapides de la recherche', () => {
  it('le + écrit un seul WATCH', async () => {
    const appended: StoredEvent[][] = []
    renderResults((produced) => appended.push([...produced]))

    fireEvent.click(screen.getByLabelText('Ajouter Dune'))

    await waitFor(() => expect(appended).toHaveLength(1))
    expect((appended[0] ?? []).map((event) => event.type)).toEqual(['WATCH'])
  })

  it('le coeur ajoute en vu daté du jour, puis marque le coup de coeur', async () => {
    const appended: StoredEvent[][] = []
    renderResults((produced) => appended.push([...produced]))

    fireEvent.click(screen.getByLabelText('Ajouter Dune en coup de cœur'))

    // Un seul lot, transactionnel : un coup de cœur est un titre déjà vu,
    // le geste écrit le cycle complet du jour puis le FAV — couper le
    // réseau entre deux écritures ne peut pas laisser un FAV sans cycle.
    await waitFor(() => expect(appended).toHaveLength(1))
    expect((appended[0] ?? []).map((event) => event.type)).toEqual([
      'WATCH',
      'START',
      'SEEN',
      'FAV',
    ])
  })

  it('le play ajoute directement en cours : WATCH puis START', async () => {
    const appended: StoredEvent[][] = []
    renderResults((produced) => appended.push([...produced]))

    fireEvent.click(screen.getByLabelText('Ajouter Dune et commencer'))

    await waitFor(() => expect(appended).toHaveLength(1))
    expect((appended[0] ?? []).map((event) => event.type)).toEqual(['WATCH', 'START'])
  })
})
