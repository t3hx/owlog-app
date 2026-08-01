import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18next from '@/i18n'
import type { MediaCatalog } from '@/ports/MediaCatalog'
import { PortsProvider } from '@/ui/PortsProvider'
import { useSearch } from '@/ui/hooks/useSearch'
import { fakePorts } from '@/ui/test/fakePorts'

beforeAll(async () => {
  await i18next.changeLanguage('fr')
})

/**
 * Catalogue qui tombe en panne réseau puis se rétablit.
 *
 * C'est la séquence exacte du mode avion : la première requête échoue parce
 * qu'il n'y a pas de réseau, les suivantes aboutissent parce qu'il est revenu.
 */
function flakyCatalog(): MediaCatalog & { calls: () => number } {
  let calls = 0

  return {
    calls: () => calls,
    search: () => {
      calls += 1
      return Promise.resolve(
        calls === 1
          ? { ok: false, failure: { kind: 'offline' } }
          : { ok: true, value: { hits: [], count: 0 } },
      )
    },
    detail: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    season: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
  }
}

function renderSearch(catalog: MediaCatalog) {
  const ports = { ...fakePorts(), catalog }

  return renderHook(() => useSearch('inception', 'all'), {
    wrapper: ({ children }) => <PortsProvider ports={ports}>{children}</PortsProvider>,
  })
}

/**
 * Reprise après une coupure réseau.
 *
 * Défaut réel, trouvé en déroulant les vérifications sur matériel : l'effet
 * de recherche ne se relançait que si le **texte** changeait. Une requête
 * tombée hors-ligne restait donc en échec pour ce texte, définitivement —
 * retaper le même titre au retour du réseau ne relançait rien, et l'app
 * donnait l'impression d'avoir perdu l'API pour de bon.
 */
describe('reprise de la recherche', () => {
  it('relance la requete quand le reseau revient', async () => {
    const catalog = flakyCatalog()
    const { result } = renderSearch(catalog)

    await waitFor(() => expect(result.current.state.status).toBe('failed'))
    expect(catalog.calls()).toBe(1)

    // Le geste de l'utilisateur : il coupe le mode avion et regarde l'écran.
    // Il ne retape pas son titre, et rien ne lui dit qu'il le devrait.
    act(() => window.dispatchEvent(new Event('online')))

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    expect(catalog.calls()).toBe(2)
  })

  it('relance la requete a la demande, sans changer le texte', async () => {
    const catalog = flakyCatalog()
    const { result } = renderSearch(catalog)

    await waitFor(() => expect(result.current.state.status).toBe('failed'))

    // Le bouton « réessayer » couvre le cas où le navigateur ne signale pas
    // la bascule réseau, ce qui arrive sur mobile.
    act(() => result.current.retry())

    await waitFor(() => expect(result.current.state.status).toBe('done'))
  })

  it('n ecoute le retour du reseau que sur un echec', async () => {
    const catalog = flakyCatalog()
    const { result } = renderSearch(catalog)

    await waitFor(() => expect(result.current.state.status).toBe('failed'))
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(result.current.state.status).toBe('done'))

    const after = catalog.calls()
    // Sur un ecran au repos, une bascule reseau ne doit rien consommer : le
    // quota TMDB est partage et il s'epuise pour tout le monde a la fois.
    act(() => window.dispatchEvent(new Event('online')))
    await vi.waitFor(() => expect(catalog.calls()).toBe(after))
  })
})
