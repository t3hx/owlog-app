import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { mediaState, type StoredEvent } from '@owlog/domain'
import { createFactory, MOVIE } from '@owlog/domain/test'
import i18next from '@/i18n'
import { partialCacheRow } from '@/ports/MediaCache'
import { PortsProvider } from '@/ui/PortsProvider'
import { Media } from '@/ui/screens/Media'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Page média.
 *
 * L'écran est la vitrine du modèle : titre depuis le cache (donc lisible
 * hors-ligne), statut depuis la ligne dérivée, journal groupé par
 * marqueurs de visionnage, et « REVOIR » qui n'apparaît que sur un titre
 * vu — c'est lui qui rend le revisionnage visible.
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

function renderMedia(events: readonly StoredEvent[]) {
  return render(
    <PortsProvider
      ports={fakePorts({
        mediaEvents: events,
        mediaStates: [mediaState(events, MOVIE)],
        mediaCache: [partialCacheRow(HIT, 'now')],
      })}
    >
      <Media ref={MOVIE} />
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

  it('un titre vu propose REVOIR, avec le numéro du prochain visionnage', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[])

    expect(await screen.findByText('REVOIR')).toBeDefined()
    expect(screen.getByText(/ouvre le visionnage #2/)).toBeDefined()
  })

  it('un titre en cours ne propose pas REVOIR', async () => {
    const f = createFactory()
    renderMedia([f.watch(), f.start('c1')] as StoredEvent[])

    await screen.findByText('Dune')
    expect(screen.queryByText('REVOIR')).toBeNull()
  })

  it('un journal vide le dit, sans casser la page', async () => {
    renderMedia([])

    expect(
      await screen.findByText('rien encore. le premier geste écrira la première ligne.'),
    ).toBeDefined()
  })
})
