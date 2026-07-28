import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { EventStore } from '@/ports/EventStore'
import type { LiveQueries } from '@/ports/LiveQueries'
import type { MediaCatalog } from '@/ports/MediaCatalog'
import type { PendingAdd, PendingAdds } from '@/ports/PendingAdds'
import type { SettingsStore } from '@/ports/SettingsStore'
import type { Ports } from '@/ui/PortsProvider'

/**
 * Doubles des ports, pour les tests de composant.
 *
 * Ils rendent des valeurs vides et échouent bruyamment sur tout ce qu'un test
 * n'a pas explicitement fourni. Un double silencieux qui rend `undefined` fait
 * passer un test pour la mauvaise raison : le composant afficherait un état
 * vide, et l'assertion sur cet état vide serait verte.
 *
 * `live` est la partie qui compte ici. Ce sont des hooks, donc un test les
 * remplace par des fonctions qui rendent un tableau fixe : le composant lit
 * alors une projection connue, sans IndexedDB ni `useLiveQuery`.
 */
export function fakePorts(overrides: {
  mediaStates?: readonly MediaStateRow[]
  pendingAdds?: readonly PendingAdd[]
} = {}): Ports {
  const mediaStates = overrides.mediaStates ?? []
  const pendingAdds = overrides.pendingAdds ?? []

  const live: LiveQueries = {
    useMediaStates: () => mediaStates,
    usePendingAdds: () => pendingAdds,
  }

  const settings: SettingsStore = {
    read: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    subscribe: () => () => undefined,
  }

  const events: EventStore = {
    append: () => Promise.resolve(),
    mediaCache: () => Promise.resolve([]),
    eventsForMedia: () => Promise.resolve([]),
    allMediaStates: () => Promise.resolve(mediaStates),
    eventsSince: () => Promise.resolve([]),
    restore: () => Promise.resolve({ added: 0, skipped: 0 }),
    rebuildAllState: () => Promise.resolve(),
  }

  const catalog: MediaCatalog = {
    search: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    detail: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
  }

  const pending: PendingAdds = {
    add: () => Promise.resolve(),
    all: () => Promise.resolve(pendingAdds),
    remove: () => Promise.resolve(),
  }

  return { settings, events, catalog, pending, live }
}
