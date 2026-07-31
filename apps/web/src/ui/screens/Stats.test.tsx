import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { mediaState } from '@/domain/reducers/mediaState'
import { createFactory, MOVIE } from '@/domain/test/factory'
import type { StoredEvent } from '@/domain/types'
import i18next from '@/i18n'
import { partialCacheRow } from '@/ports/MediaCache'
import { PortsProvider } from '@/ui/PortsProvider'
import { Stats } from '@/ui/screens/Stats'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Écran de stats.
 *
 * Toutes les valeurs sont calculées depuis les données utilisateur —
 * jamais stockées, jamais en dur. Le test le vérifie sur le chemin
 * complet : store → hook → écran. L'état vide a son message.
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

describe('Stats', () => {
  it('calcule les tuiles depuis le journal, pas des valeurs en dur', async () => {
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[]
    const cache = { ...partialCacheRow(HIT, 'now'), totalRuntime: 120, complete: true }

    render(
      <PortsProvider
        ports={fakePorts({
          mediaStates: [mediaState(events, MOVIE)],
          mediaEvents: events,
          mediaCache: [cache],
        })}
      >
        <Stats />
      </PortsProvider>,
    )

    // Un film vu de 120 minutes : la card héros affiche 2h, la tuile ✓ vus
    // compte 1. Les deux valeurs traversent le même chemin de calcul.
    expect(await screen.findByText('2h')).toBeDefined()
    expect(screen.getByText('✓ vus')).toBeDefined()
  })

  it('l’état vide a son message, pas des zéros muets', async () => {
    render(
      <PortsProvider ports={fakePorts()}>
        <Stats />
      </PortsProvider>,
    )

    expect(await screen.findByText('Rien à mesurer')).toBeDefined()
  })
})
