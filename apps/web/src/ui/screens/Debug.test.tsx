import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { mediaState, type StoredEvent } from '@owlog/domain'
import { createFactory, MOVIE } from '@owlog/domain/test'
import i18next from '@/i18n'
import { PortsProvider, type Ports } from '@/ui/PortsProvider'
import { Debug } from '@/ui/screens/Debug'
import { fakePorts } from '@/ui/test/fakePorts'

/**
 * Écran de diagnostic.
 *
 * Il répond à « ça ne marche pas » sans outil de développement : les
 * métriques viennent du store (pas d'exemples), les événements de type
 * inconnu sont comptés au lieu d'être silencieusement perdus, et le
 * panneau de sync déclenche réellement le moteur.
 */
beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

describe('Debug', () => {
  it('mesure la bibliothèque depuis le store', async () => {
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.seen('c1')] as StoredEvent[]

    render(
      <PortsProvider
        ports={fakePorts({ mediaStates: [mediaState(events, MOVIE)], mediaEvents: events })}
      >
        <Debug />
      </PortsProvider>,
    )

    expect(await screen.findByText('medias')).toBeDefined()
    // Un média, un cycle terminé : l'entrée de journal du SEEN est comptée.
    expect(screen.getByText('entrees_de_journal')).toBeDefined()
  })

  it('compte les événements de type inconnu — ignorer ne veut pas dire perdre', async () => {
    const f = createFactory()
    const events = [f.watch(), f.unknown('FROM_THE_FUTURE')] as StoredEvent[]

    render(
      <PortsProvider
        ports={fakePorts({ mediaStates: [mediaState(events, MOVIE)], mediaEvents: events })}
      >
        <Debug />
      </PortsProvider>,
    )

    expect(await screen.findByText('└ FROM_THE_FUTURE')).toBeDefined()
  })

  it('« re-pousser tout » parle au moteur de sync, pas à un stub d’écran', async () => {
    const repushAll = vi.fn(() => Promise.resolve())
    const base = fakePorts()
    const ports: Ports = { ...base, sync: { ...base.sync, repushAll } }

    render(
      <PortsProvider ports={ports}>
        <Debug />
      </PortsProvider>,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 're-pousser tout le journal et le cache' }),
    )

    await waitFor(() => {
      expect(repushAll).toHaveBeenCalledOnce()
    })
  })
})
