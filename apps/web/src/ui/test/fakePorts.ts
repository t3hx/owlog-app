import type { SeasonDetail } from '@owlog/contracts'
import type { MediaStateRow, StoredEvent } from '@owlog/domain'
import type { MediaCacheRow } from '@/ports/MediaCache'
import type { EventStore } from '@/ports/EventStore'
import type { LiveQueries } from '@/ports/LiveQueries'
import type { MediaCatalog } from '@/ports/MediaCatalog'
import type { PendingAdd, PendingAdds } from '@/ports/PendingAdds'
import type { SettingsStore } from '@/ports/SettingsStore'
import type { SocialGateway } from '@/ports/SocialGateway'
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
  /**
   * Ce que `catalog.season` rend. Sans elle : hors-ligne — le défaut le plus
   * honnête, celui où la fiche doit se taire plutôt qu'afficher un trou.
   */
  seasonDetail?: SeasonDetail
  /** Reçoit ce que les commandes écrivent, pour l'affirmer dans un test. */
  onAppend?: (produced: readonly StoredEvent[]) => void
  /** Remplace `catalog.detail`, pour affirmer qu'un rafraîchissement part — ou pas. */
  detail?: MediaCatalog['detail']
  /** Remplace des appels d'authentification, pour les ecrans de connexion. */
  auth?: Partial<Ports['auth']>
  /**
   * Ce que les surfaces sociales rendent. Partiel : un test ne fournit que
   * les appels que son écran fait, le reste reste hors-ligne — le défaut le
   * plus honnête, celui où l'écran doit montrer un état et non un trou.
   */
  social?: Partial<SocialGateway>
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
    detail: overrides.detail ?? (() => Promise.resolve({ ok: false, failure: { kind: 'offline' } })),
    season: () =>
      Promise.resolve(
        overrides.seasonDetail === undefined
          ? { ok: false, failure: { kind: 'offline' } }
          : { ok: true, value: overrides.seasonDetail },
      ),
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
      Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName: null, pseudo: null } }),
    verifyLink: () =>
      Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName: null, pseudo: null } }),
    me: () => Promise.resolve({ ok: true, value: null }),
    // Renvoie le pseudo reçu : la rangée de Réglages lit la réponse du
    // serveur, jamais sa propre saisie — le serveur fait autorité.
    updateProfile: (patch) =>
      Promise.resolve({
        ok: true,
        value: {
          email: 'a@b.c',
          firstName: patch.firstName ?? null,
          pseudo: patch.pseudo ?? null,
        },
      }),
    logout: () => Promise.resolve({ ok: true, value: undefined }),
    // Aucun fournisseur par defaut : l'ecran de connexion se rend alors
    // sans bouton, ce qui est l'etat d'un deploiement sans secrets OAuth.
    oauthProviders: () => Promise.resolve({ ok: true, value: [] }),
    oauthBegin: () => Promise.resolve({ ok: false, failure: { kind: 'unavailable' } }),
    oauthComplete: () =>
      Promise.resolve({ ok: true, value: { email: 'a@b.c', firstName: null, pseudo: null } }),
    ...overrides.auth,
  }

  const social: Ports['social'] = {
    search: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    request: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    accept: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    decline: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    circle: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    profile: () => Promise.resolve({ ok: false, failure: { kind: 'offline' } }),
    ...overrides.social,
  }

  const local: Ports['local'] = {
    purgeAll: () => Promise.resolve(),
  }

  return {
    settings,
    events,
    catalog,
    pending,
    live,
    deviceId: 'device-test',
    sync,
    auth,
    social,
    local,
  }
}
