import type { MediaStateRow, StoredEvent } from '@owlog/domain'
import type { MediaCacheRow } from '@/ports/MediaCache'
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
  mediaEvents?: readonly StoredEvent[]
  /** Ce que le LOG global reçoit à sa première page. */
  recentEvents?: readonly StoredEvent[]
  mediaCache?: readonly MediaCacheRow[]
  /** Reçoit ce que les commandes écrivent, pour l'affirmer dans un test. */
  onAppend?: (produced: readonly StoredEvent[]) => void
} = {}): Ports {
  const mediaStates = overrides.mediaStates ?? []
  const pendingAdds = overrides.pendingAdds ?? []

  const live: LiveQueries = {
    useMediaStates: () => mediaStates,
    usePendingAdds: () => pendingAdds,
    useMediaEvents: () => overrides.mediaEvents ?? [],
    useMediaState: (ref) => mediaStates.find((row) => row.ref === ref),
    useMediaCacheRow: (ref) => overrides.mediaCache?.find((row) => row.ref === ref),
    useMediaCacheRows: () => overrides.mediaCache ?? [],
    usePendingPushCount: () => 0,
  }

  const settings: SettingsStore = {
    read: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    subscribe: () => () => undefined,
  }

  const events: EventStore = {
    append: (produced) => {
      overrides.onAppend?.(produced)
      return Promise.resolve()
    },
    mediaCache: () => Promise.resolve([]),
    // Même source que la lecture réactive : une commande qui relit le journal
    // au moment d'écrire doit voir ce que l'écran affichait.
    eventsForMedia: () => Promise.resolve(overrides.mediaEvents ?? []),
    allMediaStates: () => Promise.resolve(mediaStates),
    eventsSince: () => Promise.resolve([]),
    eventsRecent: () => Promise.resolve(overrides.recentEvents ?? []),
    upsertMediaCache: () => Promise.resolve(),
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

  const sync: Ports['sync'] = {
    start: () => Promise.resolve(),
    stop: () => undefined,
    syncNow: () => Promise.resolve(),
    repushAll: () => Promise.resolve(),
    status: () => ({
      syncing: false,
      lastSyncAt: null,
      lastError: null,
      unauthorized: false,
      enabled: true,
      pulledEvents: 0,
    }),
    subscribe: () => () => undefined,
  }

  const auth: Ports['auth'] = {
    requestLink: () => Promise.resolve({ ok: true, value: undefined }),
    verifyCode: () =>
      Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName: null } }),
    verifyLink: () =>
      Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName: null } }),
    me: () => Promise.resolve({ ok: true, value: null }),
    updateProfile: (firstName) =>
      Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName } }),
    logout: () => Promise.resolve({ ok: true, value: undefined }),
  }

  const local: Ports['local'] = {
    purgeAll: () => Promise.resolve(),
  }

  return { settings, events, catalog, pending, live, deviceId: 'device-test', sync, auth, local }
}
