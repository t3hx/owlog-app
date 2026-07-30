import {
  SYNC_BATCH_LIMIT,
  type PulledCacheRow,
  type SerializedEvent,
  type SyncCacheRow,
} from '@owlog/contracts'

import type { StoredEvent } from '@/domain/types'
import type { EventStore } from '@/ports/EventStore'
import type { MediaCacheRow } from '@/ports/MediaCache'
import type { Outbox } from '@/ports/Outbox'
import type { SettingsStore } from '@/ports/SettingsStore'
import type { SyncEngine, SyncStatus } from '@/ports/Sync'
import type { SyncFailure, SyncGateway } from '@/ports/SyncGateway'

export type { SyncEngine, SyncStatus } from '@/ports/Sync'

/**
 * Le moteur de synchronisation. Orchestrateur, hors domaine : il ne
 * connaît ni Dexie ni HTTP, seulement les ports.
 *
 * ```
 * push : append local ─▶ outbox (même transaction) ─▶ observeCount
 *        ─▶ debounce 2 s ─▶ lot de 500 ─▶ POST /sync ─▶ ids acquittés
 * pull : démarrage / retour réseau / premier plan ─▶ GET /sync?after=
 *        ─▶ restore() idempotent ─▶ curseur avancé page par page
 * ```
 *
 * Conduites non négociables, chacune couverte par un test :
 *
 * - **Le debounce absorbe les rafales** — les `PROG` du bouton play
 *   partent en un lot, pas en dix requêtes.
 * - **404 : silence.** Le serveur en face n'a pas encore `/sync` ; « pas
 *   encore à jour » n'est pas une panne.
 * - **401 sans jamais avoir synchronisé : silence aussi.** Le compte est
 *   optionnel — sans session, l'app est exactement le temps 1, et elle ne
 *   harcèle personne. Le bit qui départage est l'existence du curseur.
 * - **401 après avoir synchronisé : UNE invite**, puis le moteur se tait
 *   jusqu'à reconnexion.
 * - **Un pull interrompu laisse un curseur cohérent** : il n'avance
 *   qu'après le `restore()` réussi de chaque page.
 * - **Ce qui vient d'être tiré ne repart pas** : la première sync remplit
 *   l'outbox AVANT de tirer, et le pull restaure sans ré-enfiler.
 * - **413 : le lot se scinde** et tout finit par passer — le cap par
 *   événement du contrat garantit que la scission converge.
 */
export interface SyncEngineDeps {
  readonly gateway: SyncGateway
  readonly store: Pick<
    EventStore,
    'restore' | 'rebuildAllState' | 'mediaCache' | 'allMediaStates'
  >
  readonly outbox: Outbox
  readonly settings: SettingsStore
  /** 2 s en production — la largeur d'une rafale de gestes. */
  readonly debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 2_000

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { gateway, store, outbox, settings } = deps
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS

  let enabled = true
  let unauthorized = false
  let syncing = false
  let lastSyncAt: string | null = null
  let lastError: SyncFailure['kind'] | null = null
  let pulledEvents = 0

  let stopObserving: (() => void) | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const subscribers = new Set<() => void>()

  /**
   * Toutes les passes s'enchaînent sur cette promesse : un flush déclenché
   * par le debounce ne peut pas s'entrelacer avec le `syncNow` d'un retour
   * au premier plan. Le serveur dédupliquerait, mais le trafic doublerait.
   */
  let chain: Promise<void> = Promise.resolve()

  function run(operation: () => Promise<void>): Promise<void> {
    chain = chain.then(operation, operation)
    return chain
  }

  function notify(): void {
    for (const callback of subscribers) callback()
  }

  function setState(patch: {
    syncing?: boolean
    lastError?: SyncFailure['kind'] | null
    unauthorized?: boolean
    enabled?: boolean
    lastSyncAt?: string
    pulledEvents?: number
  }): void {
    if (patch.syncing !== undefined) syncing = patch.syncing
    if (patch.lastError !== undefined) lastError = patch.lastError
    if (patch.unauthorized !== undefined) unauthorized = patch.unauthorized
    if (patch.enabled !== undefined) enabled = patch.enabled
    if (patch.lastSyncAt !== undefined) lastSyncAt = patch.lastSyncAt
    if (patch.pulledEvents !== undefined) pulledEvents = patch.pulledEvents
    notify()
  }

  /**
   * Applique la règle de conduite d'un échec. Rend `true` si la passe doit
   * s'arrêter là — c'est le cas de tous les échecs : la reprise appartient
   * au déclencheur suivant, jamais à une boucle de retry locale.
   */
  async function handleFailure(failure: SyncFailure): Promise<void> {
    if (failure.kind === 'unauthorized') {
      const hasEverSynced = (await settings.read('syncCursor')) !== undefined
      if (hasEverSynced) {
        // Session expirée : UNE invite, et le moteur se tait.
        setState({ unauthorized: true, enabled: false })
      } else {
        // Jamais synchronisé : pas de compte, pas de bruit.
        setState({ enabled: false })
      }
      return
    }

    if (failure.kind === 'not-deployed') {
      // Le serveur n'a pas encore les routes /sync. Silencieux.
      return
    }

    setState({ lastError: failure.kind })
  }

  async function readCursor(key: 'syncCursor' | 'syncCacheCursor'): Promise<number> {
    const raw = await settings.read(key)
    const parsed = raw === undefined ? 0 : Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
  }

  /** Vide l'outbox vers le serveur, lot par lot. Rend `false` sur échec. */
  async function flushPush(options: { includeAllCache: boolean }): Promise<boolean> {
    // Le cache complet part avec la première connexion et « re-pousser
    // tout » : les titres et affiches vivent là, pas dans le journal — un
    // appareil vierge qui ne recevrait que les événements reconstruirait
    // des pastilles sans titres.
    let cacheBacklog: MediaCacheRow[] = []
    if (options.includeAllCache) {
      const refs = (await store.allMediaStates()).map((row) => row.ref)
      cacheBacklog = [...(await store.mediaCache(refs))]
    }

    for (;;) {
      const batch = await outbox.nextBatch(SYNC_BATCH_LIMIT)
      const cacheChunk = options.includeAllCache
        ? cacheBacklog.splice(0, SYNC_BATCH_LIMIT)
        : await rowsTouchedBy(batch)

      if (batch.length === 0 && cacheChunk.length === 0) return true

      const sent = await send([...batch], cacheChunk)
      if (sent !== 'ok') {
        await handleFailure(sent)
        return false
      }
    }
  }

  /** Les lignes de cache des médias du lot — les ajouts partent affichables. */
  async function rowsTouchedBy(batch: readonly StoredEvent[]): Promise<MediaCacheRow[]> {
    if (batch.length === 0) return []
    const refs = [...new Set(batch.map((event) => event.media_ref))]
    return [...(await store.mediaCache(refs))]
  }

  /**
   * Envoie un lot, en le scindant sur 413. La récursion converge : le cap
   * par événement du contrat garantit qu'un élément seul passe toujours —
   * sauf événement hors contrat, qui s'arrête ici en `lastError` plutôt
   * que de boucler.
   */
  async function send(
    events: StoredEvent[],
    cacheRows: MediaCacheRow[],
  ): Promise<'ok' | SyncFailure> {
    const result = await gateway.push({
      events: events as unknown as SerializedEvent[],
      cacheRows: cacheRows.map((row): SyncCacheRow => ({ ref: row.ref, payload: row })),
    })

    if (result.ok) {
      await outbox.acknowledge(result.value.accepted)
      return 'ok'
    }

    if (result.failure.kind === 'payload-too-large' && events.length + cacheRows.length > 1) {
      const halfEvents = Math.ceil(events.length / 2)
      const halfCache = Math.ceil(cacheRows.length / 2)
      const first = await send(events.slice(0, halfEvents), cacheRows.slice(0, halfCache))
      if (first !== 'ok') return first
      return send(events.slice(halfEvents), cacheRows.slice(halfCache))
    }

    return result.failure
  }

  /** Tire tout ce que le serveur a d'inconnu. Rend `false` sur échec. */
  async function pullAll(options: { deferRefresh: boolean }): Promise<boolean> {
    let after = await readCursor('syncCursor')
    let cacheAfter = await readCursor('syncCacheCursor')

    for (;;) {
      const result = await gateway.pull({ after, cacheAfter })
      if (!result.ok) {
        await handleFailure(result.failure)
        return false
      }

      const { events, cacheRows, hasMore } = result.value
      if (events.length > 0 || cacheRows.length > 0) {
        await store.restore(
          events.map((pulled) => pulled.event as unknown as StoredEvent),
          cacheRows.map(pulledCacheRow).filter((row) => row !== null),
          // Ré-enfiler ce qu'on vient de tirer doublerait chaque pull ; le
          // recalcul différé appartient au pull initial (O(n²) par lot).
          { enqueuePush: false, refreshState: !options.deferRefresh },
        )

        after = events.reduce((max, e) => Math.max(max, e.serverSeq), after)
        cacheAfter = cacheRows.reduce((max, r) => Math.max(max, r.updatedSeq), cacheAfter)
        // Le compteur du premier pull : la page vient d'être APPLIQUÉE, il
        // peut monter — pas avant, l'écran afficherait de l'espoir.
        setState({ pulledEvents: pulledEvents + events.length })
      }

      // Le curseur n'avance qu'APRÈS le restore réussi de la page : une
      // session qui expire mi-pull laisse un curseur cohérent, jamais un
      // trou. Écrit même sans page : « j'ai déjà synchronisé » est le bit
      // qui distingue la session expirée de l'absence de compte.
      await settings.write('syncCursor', String(after))
      await settings.write('syncCacheCursor', String(cacheAfter))

      if (!hasMore) return true
    }
  }

  /**
   * La ligne de cache telle que ce client l'a poussée. Le serveur la rend
   * opaque ; un payload qui n'a pas la forme attendue — autre version du
   * client, corruption — est ignoré plutôt que d'empoisonner le cache.
   */
  function pulledCacheRow(row: PulledCacheRow): MediaCacheRow | null {
    const payload = row.payload
    if (typeof payload !== 'object' || payload === null) return null
    if ((payload as { ref?: unknown }).ref !== row.ref) return null
    if (typeof (payload as { title?: unknown }).title !== 'string') return null
    return payload as MediaCacheRow
  }

  async function syncPass(): Promise<void> {
    if (!enabled) return
    setState({ syncing: true, lastError: null, pulledEvents: 0 })

    try {
      const firstSync = (await settings.read('syncCursor')) === undefined

      // Première connexion d'un appareil déjà rempli : tout le journal
      // local part — l'historique du temps 1 n'est jamais passé par
      // l'outbox. AVANT le pull, pour que rien de tiré ne reparte.
      if (firstSync) await outbox.enqueueAll()

      const pushed = await flushPush({ includeAllCache: firstSync })
      if (!pushed) return

      const pulled = await pullAll({ deferRefresh: firstSync })
      if (!pulled) return

      // Le recalcul différé du pull initial : une seule passe, à la fin.
      if (firstSync) await store.rebuildAllState()

      setState({ lastSyncAt: new Date().toISOString() })
    } finally {
      setState({ syncing: false })
    }
  }

  function schedulePush(): void {
    if (!enabled) return
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void run(async () => {
        if (!enabled) return
        setState({ syncing: true })
        try {
          const pushed = await flushPush({ includeAllCache: false })
          if (pushed) setState({ lastError: null, lastSyncAt: new Date().toISOString() })
        } finally {
          setState({ syncing: false })
        }
      })
    }, debounceMs)
  }

  return {
    async start(): Promise<void> {
      // Ré-arme un moteur tu : c'est le chemin de la (re)connexion. Une
      // session vient d'être posée — le silence du 401 n'a plus de raison.
      setState({ enabled: true, unauthorized: false })
      stopObserving ??= outbox.observeCount((count) => {
        if (count > 0) schedulePush()
      })
      await run(syncPass)
    },

    stop(): void {
      stopObserving?.()
      stopObserving = null
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      debounceTimer = null
      enabled = false
    },

    syncNow(): Promise<void> {
      return run(syncPass)
    },

    async repushAll(): Promise<void> {
      await outbox.enqueueAll()
      await run(async () => {
        if (!enabled) return
        setState({ syncing: true })
        try {
          const pushed = await flushPush({ includeAllCache: true })
          if (pushed) setState({ lastError: null, lastSyncAt: new Date().toISOString() })
        } finally {
          setState({ syncing: false })
        }
      })
    },

    status(): SyncStatus {
      return { syncing, lastSyncAt, lastError, unauthorized, enabled, pulledEvents }
    },

    subscribe(callback: () => void): () => void {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
  }
}
