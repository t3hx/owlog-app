import type { PushRequest, SerializedEvent } from '@owlog/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createEventStore } from '@/adapters/dexie/eventStore'
import { createOutbox } from '@/adapters/dexie/outbox'
import { createSettingsStore } from '@/adapters/dexie/settingsStore'
import { createSyncEngine, type SyncEngine } from '@/adapters/sync/engine'
import { createFactory, MOVIE } from '@owlog/domain/test'
import type { DomainEvent, StoredEvent } from '@owlog/domain'
import { partialCacheRow, type MediaCacheRow } from '@/ports/MediaCache'
import type { SyncFailure, SyncGateway } from '@/ports/SyncGateway'

/**
 * Le moteur de synchronisation, contre les vrais adaptateurs Dexie et un
 * faux serveur qui reproduit la sémantique de F4 : attribution de
 * `server_seq`, curseurs, idempotence par id.
 *
 * Ce qui se vérifie ici, c'est la CONDUITE : le debounce absorbe les
 * rafales, un 404 se tait, un 401 ne parle qu'une fois — et jamais à un
 * utilisateur sans compte —, un 413 scinde, un pull interrompu laisse un
 * curseur cohérent, et ce qui vient d'être tiré ne repart pas.
 */

interface FakeServer {
  readonly gateway: SyncGateway
  readonly pushCalls: PushRequest[]
  readonly events: { seq: number; event: StoredEvent }[]
  /** Programme l'échec des prochains appels. `null` remet le beau temps. */
  fail(failure: SyncFailure | null, options?: { onlyNext?: number }): void
  seed(events: readonly StoredEvent[], cacheRows?: readonly MediaCacheRow[]): void
}

function fakeServer(options: { pageLimit?: number } = {}): FakeServer {
  const pageLimit = options.pageLimit ?? 500
  const events: { seq: number; event: StoredEvent }[] = []
  const cache = new Map<string, { seq: number; payload: unknown }>()
  const pushCalls: PushRequest[] = []
  let seq = 0
  let cacheSeq = 0
  let failure: SyncFailure | null = null
  let failuresLeft = Infinity

  function currentFailure(): SyncFailure | null {
    if (failure === null || failuresLeft <= 0) return null
    failuresLeft -= 1
    return failure
  }

  return {
    pushCalls,
    events,
    fail(next, opts) {
      failure = next
      failuresLeft = opts?.onlyNext ?? Infinity
    },
    seed(seeded, cacheRows = []) {
      for (const event of seeded) events.push({ seq: ++seq, event })
      for (const row of cacheRows) cache.set(row.ref, { seq: ++cacheSeq, payload: row })
    },
    gateway: {
      async push(request) {
        const failed = currentFailure()
        if (failed) return { ok: false, failure: failed }

        pushCalls.push(request)
        for (const event of request.events) {
          if (!events.some((known) => known.event.id === event.id)) {
            events.push({ seq: ++seq, event: event as StoredEvent })
          }
        }
        for (const row of request.cacheRows ?? []) {
          cache.set(row.ref, { seq: ++cacheSeq, payload: row.payload })
        }
        return { ok: true, value: { accepted: request.events.map((e) => e.id) } }
      },

      async pull({ after, cacheAfter }) {
        const failed = currentFailure()
        if (failed) return { ok: false, failure: failed }

        const page = events.filter((row) => row.seq > after).slice(0, pageLimit)
        const cachePage = [...cache.entries()]
          .map(([ref, row]) => ({ ref, updatedSeq: row.seq, payload: row.payload }))
          .filter((row) => row.updatedSeq > cacheAfter)
          .sort((a, b) => a.updatedSeq - b.updatedSeq)
          .slice(0, pageLimit)

        return {
          ok: true,
          value: {
            events: page.map((row) => ({
              serverSeq: row.seq,
              event: row.event as SerializedEvent,
            })),
            cacheRows: cachePage,
            hasMore: page.length === pageLimit || cachePage.length === pageLimit,
          },
        }
      },
    },
  }
}

let engine: SyncEngine | null = null

function makeEngine(gateway: SyncGateway, debounceMs = 30): SyncEngine {
  engine = createSyncEngine({
    gateway,
    store: createEventStore(),
    outbox: createOutbox(),
    settings: createSettingsStore(),
    debounceMs,
  })
  return engine
}

/** Attend que la file soit vide et le moteur au repos. */
async function drained(outbox = createOutbox()): Promise<void> {
  await vi.waitFor(async () => {
    expect(await outbox.count()).toBe(0)
  })
}

describe('SyncEngine', () => {
  beforeEach(async () => {
    await db.settings.clear()
    await db.events.clear()
    await db.media_state.clear()
    await db.media_cache.clear()
    await db.pending_push.clear()
  })

  afterEach(() => {
    engine?.stop()
    engine = null
  })

  it('première sync : tire le serveur, pousse tout le journal local, cache compris', async () => {
    const server = fakeServer()
    const remote = createFactory()
    const seededEvents = [remote.watch(), remote.seen('rc1')] as DomainEvent[]
    server.seed(seededEvents, [partialCacheRow(hit('Seeded'), '2026-07-30T00:00:00.000Z')])

    // L'appareil est déjà rempli : un historique du temps 1, jamais poussé.
    const local = createFactory('tmdb:tv/1396')
    const store = createEventStore()
    await store.append([local.watch()] as DomainEvent[])
    await db.pending_push.clear() // comme un historique d'avant l'outbox
    await store.upsertMediaCache([partialCacheRow(hit('Local', 'tmdb:tv/1396'), 'now')])

    await makeEngine(server.gateway).start()
    await drained()

    // Le serveur a reçu l'historique local ET sa ligne de cache.
    expect(server.events.some((r) => r.event.media_ref === 'tmdb:tv/1396')).toBe(true)
    const pushedCacheRefs = server.pushCalls.flatMap((c) => (c.cacheRows ?? []).map((r) => r.ref))
    expect(pushedCacheRefs).toContain('tmdb:tv/1396')

    // Le journal local contient l'union, et l'état dérivé est reconstruit
    // malgré le recalcul différé du pull initial.
    expect(await db.events.count()).toBe(3)
    const state = await db.media_state.get(MOVIE)
    expect(state?.status).toBe('seen')

    // Les curseurs sont persistés — la prochaine sync repartira d'ici.
    const settings = createSettingsStore()
    expect(Number(await settings.read('syncCursor'))).toBeGreaterThan(0)
  })

  it('ce qui vient d’être tiré ne repart pas vers le serveur', async () => {
    const server = fakeServer()
    const remote = createFactory()
    server.seed([remote.watch()] as DomainEvent[])

    await makeEngine(server.gateway).start()
    await drained()

    const pushedIds = server.pushCalls.flatMap((c) => c.events.map((e) => e.id))
    expect(pushedIds).toEqual([])
  })

  it('le pull pagine jusqu’au bout, curseur avancé page par page', async () => {
    const server = fakeServer({ pageLimit: 2 })
    const remote = createFactory()
    server.seed([
      remote.watch(),
      remote.start('c1'),
      remote.prog('c1', 40),
      remote.seen('c1'),
      remote.fav(),
    ] as DomainEvent[])

    await makeEngine(server.gateway).start()
    await drained()

    expect(await db.events.count()).toBe(5)
    const settings = createSettingsStore()
    expect(await settings.read('syncCursor')).toBe('5')
  })

  it('le debounce absorbe une rafale d’appends en un seul push', async () => {
    const server = fakeServer()
    const e = makeEngine(server.gateway)
    await e.start()
    await drained()

    // La rafale PROG du bouton play : trois écritures coup sur coup.
    const store = createEventStore()
    const f = createFactory()
    await store.append([f.start('c1')] as DomainEvent[])
    await store.append([f.prog('c1', 10)] as DomainEvent[])
    await store.append([f.prog('c1', 20)] as DomainEvent[])

    await drained()

    // Un seul push pour les trois événements, pas trois.
    const bursts = server.pushCalls.filter((c) => c.events.length > 0)
    expect(bursts).toHaveLength(1)
    expect(bursts[0]!.events).toHaveLength(3)
  })

  it('404 : le serveur n’est pas encore à jour, et personne n’en entend parler', async () => {
    const server = fakeServer()
    server.fail({ kind: 'not-deployed' })

    const e = makeEngine(server.gateway)
    await e.start()

    expect(e.status().lastError).toBeNull()
    expect(e.status().unauthorized).toBe(false)
  })

  it('401 sans jamais avoir synchronisé : silence — le compte est optionnel', async () => {
    const server = fakeServer()
    server.fail({ kind: 'unauthorized' })

    const e = makeEngine(server.gateway)
    await e.start()

    expect(e.status().unauthorized).toBe(false)
    expect(e.status().enabled).toBe(false)
  })

  it('401 après avoir déjà synchronisé : UNE invite, puis plus d’appels', async () => {
    const server = fakeServer()
    const e = makeEngine(server.gateway)
    await e.start()
    await drained() // première sync réussie : le curseur existe

    server.fail({ kind: 'unauthorized' })
    await e.syncNow()
    expect(e.status().unauthorized).toBe(true)

    // Le moteur se tait ensuite : pas de nouvel appel réseau.
    const calls = server.pushCalls.length
    await e.syncNow()
    expect(server.pushCalls.length).toBe(calls)
  })

  it('401 au milieu d’un pull paginé : le curseur reste sur la dernière page appliquée', async () => {
    const server = fakeServer({ pageLimit: 2 })
    const remote = createFactory()
    server.seed([remote.watch(), remote.start('c1'), remote.seen('c1')] as DomainEvent[])

    const e = makeEngine(server.gateway)
    await e.start()
    await drained() // tout est tiré : curseur à 3

    server.seed([remote.fav(), remote.unfav(), remote.remove()] as DomainEvent[])
    // La première page passe, la seconde tombe sur une session expirée.
    server.fail(null)
    let pulls = 0
    const gateway: SyncGateway = {
      push: server.gateway.push,
      pull: (cursors) => {
        pulls += 1
        if (pulls === 2) return Promise.resolve({ ok: false, failure: { kind: 'unauthorized' } })
        return server.gateway.pull(cursors)
      },
    }
    const resumed = createSyncEngine({
      gateway,
      store: createEventStore(),
      outbox: createOutbox(),
      settings: createSettingsStore(),
      debounceMs: 30,
    })
    await resumed.syncNow()
    resumed.stop()

    // Page 1 (2 événements) appliquée, curseur à 5 ; rien de perdu, rien
    // de sauté : la reprise repartira de 5.
    expect(await db.events.count()).toBe(5)
    expect(await createSettingsStore().read('syncCursor')).toBe('5')
    expect(resumed.status().unauthorized).toBe(true)
  })

  it('413 : le lot se scinde et tout finit par passer', async () => {
    const server = fakeServer()
    const inner = server.gateway
    const gateway: SyncGateway = {
      pull: inner.pull,
      push: (request) =>
        request.events.length > 2
          ? Promise.resolve({ ok: false, failure: { kind: 'payload-too-large' } })
          : inner.push(request),
    }

    const e = makeEngine(gateway)
    await e.start()
    await drained()

    const store = createEventStore()
    const f = createFactory()
    await store.append([
      f.watch(),
      f.start('c1'),
      f.prog('c1', 10),
      f.prog('c1', 20),
      f.seen('c1'),
    ] as DomainEvent[])

    await drained()
    expect(server.events.filter((r) => r.event.media_ref === MOVIE)).toHaveLength(5)
    expect(server.pushCalls.every((c) => c.events.length <= 2)).toBe(true)
  })

  it('hors-ligne : rien ne se perd, tout repart au déclencheur suivant', async () => {
    const server = fakeServer()
    const e = makeEngine(server.gateway)
    await e.start()
    await drained()

    server.fail({ kind: 'offline' })
    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch()] as DomainEvent[])

    const outbox = createOutbox()
    await vi.waitFor(() => {
      expect(e.status().lastError).toBe('offline')
    })
    expect(await outbox.count()).toBe(1)

    // Le réseau revient : le déclencheur suivant vide la file.
    server.fail(null)
    await e.syncNow()
    await drained()
  })

  it('start() ré-arme un moteur tu — le parcours de reconnexion', async () => {
    // L'utilisateur anonyme a fait taire le moteur au boot (401 silencieux).
    // Il se connecte : l'écran de connexion rappelle start(), qui doit
    // ré-armer ET synchroniser — sinon la connexion ne synchronise rien
    // avant le prochain rechargement complet.
    const server = fakeServer()
    server.fail({ kind: 'unauthorized' })
    const e = makeEngine(server.gateway)
    await e.start()
    expect(e.status().enabled).toBe(false)

    server.fail(null)
    const remote = createFactory()
    server.seed([remote.watch()] as DomainEvent[])
    await e.start()

    expect(e.status().enabled).toBe(true)
    expect(e.status().unauthorized).toBe(false)
    expect(await db.events.count()).toBe(1)
  })

  it('compte les événements tirés pendant la passe — l’écran de premier pull', async () => {
    const server = fakeServer({ pageLimit: 2 })
    const remote = createFactory()
    server.seed([remote.watch(), remote.start('c1'), remote.seen('c1')] as DomainEvent[])

    const e = makeEngine(server.gateway)
    const observed: number[] = []
    e.subscribe(() => observed.push(e.status().pulledEvents))
    await e.start()

    // Le compteur monte page par page et finit au total.
    expect(e.status().pulledEvents).toBe(3)
    expect(observed).toContain(2)
  })

  it('app tuée entre l’append et le flush : rien n’est perdu au redémarrage', async () => {
    // Vie 1 : un geste est écrit, l'app meurt avant que le debounce ne
    // parte. L'outbox a été remplie DANS la transaction de l'append —
    // c'est toute sa raison d'être.
    const server = fakeServer()
    const firstLife = makeEngine(server.gateway)
    await firstLife.start()
    await drained()

    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch()] as DomainEvent[])
    firstLife.stop()
    expect(server.events).toHaveLength(0)

    // Vie 2 : redémarrage. Le moteur relit la file et pousse.
    const secondLife = makeEngine(server.gateway)
    await secondLife.start()
    await drained()

    expect(server.events).toHaveLength(1)
  })

  it('deux onglets synchronisent en même temps sans trou ni doublon', async () => {
    // Deux onglets = deux moteurs sur la MÊME base et les MÊMES réglages.
    // Le pire cas : les deux tirent en même temps, chacun avance le
    // curseur. `restore()` est idempotent par id et le curseur ne recule
    // jamais vers un état incohérent — le journal final est exact.
    const server = fakeServer({ pageLimit: 2 })
    const remote = createFactory()
    server.seed([
      remote.watch(),
      remote.start('c1'),
      remote.prog('c1', 40),
      remote.seen('c1'),
      remote.fav(),
    ] as DomainEvent[])

    const deps = () => ({
      gateway: server.gateway,
      store: createEventStore(),
      outbox: createOutbox(),
      settings: createSettingsStore(),
      debounceMs: 30,
    })
    const tabA = createSyncEngine(deps())
    const tabB = createSyncEngine(deps())

    await Promise.all([tabA.start(), tabB.start()])
    tabA.stop()
    tabB.stop()

    expect(await db.events.count()).toBe(5)
    expect(await createSettingsStore().read('syncCursor')).toBe('5')

    // Un pull ultérieur ne rapporte rien : le curseur est cohérent.
    const later = makeEngine(server.gateway)
    await later.syncNow()
    expect(await db.events.count()).toBe(5)
  })

  it('repushAll remet tout le journal en file et le serveur déduplique', async () => {
    const server = fakeServer()
    const e = makeEngine(server.gateway)
    await e.start()
    await drained()

    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch(), f.seen('c1')] as DomainEvent[])
    await drained()

    const before = server.events.length
    await e.repushAll()
    await drained()

    // Idempotent : rien ne double côté serveur.
    expect(server.events.length).toBe(before)
  })
})

function hit(title: string, ref: MediaCacheRow['ref'] = MOVIE) {
  return { ref, kind: 'movie' as const, title, year: 2020, posterPath: null }
}
