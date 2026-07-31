import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { createFactory, MOVIE } from '@/domain/test/factory'
import type { StoredEvent } from '@/domain/types'
import i18next from '@/i18n'
import { partialCacheRow } from '@/ports/MediaCache'
import { PortsProvider } from '@/ui/PortsProvider'
import { Log } from '@/ui/screens/Log'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * LOG global.
 *
 * Ce qui compte : les entrées viennent du flux décroissant du store, le
 * compteur dit ce qui est chargé, le titre vient du cache — et l'état
 * vide est une invitation, pas un écran cassé.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

const HIT = {
  ref: MOVIE,
  kind: 'movie' as const,
  title: 'Dune',
  year: 2021,
  posterPath: null,
}

function renderLog(recentEvents: readonly StoredEvent[]) {
  return render(
    <PortsProvider
      ports={fakePorts({
        recentEvents,
        mediaCache: [partialCacheRow(HIT, 'now')],
      })}
    >
      <Log />
    </PortsProvider>,
  )
}

describe('Log', () => {
  it('rend les entrées du flux avec leur titre et le compteur', async () => {
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[]

    // `eventsRecent` rend du plus récent au plus ancien.
    renderLog([...events].reverse())

    expect(await screen.findByText('› 3 entrées affichées')).toBeDefined()
    expect(screen.getAllByText('Dune').length).toBeGreaterThan(0)
  })

  it('l’état vide invite au premier geste', async () => {
    renderLog([])

    expect(await screen.findByText('Ton log est vide')).toBeDefined()
  })
})
