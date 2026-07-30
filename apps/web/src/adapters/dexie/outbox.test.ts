import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createEventStore } from '@/adapters/dexie/eventStore'
import { createOutbox } from '@/adapters/dexie/outbox'
import { createFactory } from '@/domain/test/factory'
import type { DomainEvent } from '@/domain/types'

/**
 * Outbox de synchronisation, contre le vrai Dexie.
 *
 * P1 de la revue Eng : le client sait ce qui reste à pousser grâce à une
 * table d'ids écrite **dans la même transaction** que `append`. Ni curseur
 * `eventsSince` (faux dès que des événements distants s'entrelacent), ni
 * filtre `device_id` (tout l'historique du temps 1 porte `local`).
 *
 * La propriété qui compte : l'app peut être tuée entre un append et un
 * flush — rien n'est perdu, l'outbox a l'id ou l'événement n'existe pas.
 */
describe('Outbox (adaptateur Dexie)', () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.media_state.clear()
    await db.media_cache.clear()
    await db.pending_push.clear()
  })

  it('append écrit l’outbox dans la même transaction', async () => {
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()
    const events = [f.watch(), f.start('c1')] as DomainEvent[]

    await store.append(events)

    expect(await outbox.count()).toBe(2)
    const batch = await outbox.nextBatch(10)
    expect(batch.map((e) => e.id)).toEqual(events.map((e) => e.id))
  })

  it('un append qui échoue ne laisse rien dans l’outbox — tout ou rien', async () => {
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()
    const known = f.watch() as DomainEvent
    await store.append([known])

    // Le doublon d'id fait échouer la transaction entière : le second
    // événement ne doit exister nulle part, ni au journal ni à l'outbox.
    const fresh = f.start('c1') as DomainEvent
    await expect(store.append([known, fresh])).rejects.toThrow()

    expect(await db.events.count()).toBe(1)
    expect(await outbox.count()).toBe(1)
  })

  it('restore alimente l’outbox avec les seuls événements nouveaux', async () => {
    // C'est le chemin de l'import `.log` : un fichier peut contenir des
    // événements déjà connus (réimport, fusion), qui ne repartent pas.
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()
    const known = f.watch() as DomainEvent
    await store.append([known])
    await outbox.acknowledge([known.id])

    const fresh = f.seen('c1') as DomainEvent
    const report = await store.restore([known, fresh], [])

    expect(report).toEqual({ added: 1, skipped: 1 })
    const batch = await outbox.nextBatch(10)
    expect(batch.map((e) => e.id)).toEqual([fresh.id])
  })

  it('restore peut ne pas alimenter l’outbox — le chemin du pull', async () => {
    // Re-pousser ce qu'on vient de tirer serait idempotent mais doublerait
    // le trafic de chaque pull.
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()

    await store.restore([f.watch()] as DomainEvent[], [], { enqueuePush: false })

    expect(await outbox.count()).toBe(0)
  })

  it('acknowledge vide ce que le serveur a accepté, et rien d’autre', async () => {
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.seen('c1')] as DomainEvent[]
    await store.append(events)

    await outbox.acknowledge([events[0]!.id, events[2]!.id])

    const left = await outbox.nextBatch(10)
    expect(left.map((e) => e.id)).toEqual([events[1]!.id])
  })

  it('enqueueAll remet tout le journal en attente — la première connexion et « re-pousser tout »', async () => {
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()
    const events = [f.watch(), f.start('c1')] as DomainEvent[]
    await store.append(events)
    await outbox.acknowledge(events.map((e) => e.id))

    const enqueued = await outbox.enqueueAll()

    expect(enqueued).toBe(2)
    expect(await outbox.count()).toBe(2)
  })

  it('nextBatch pagine par identifiant croissant', async () => {
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.prog('c1', 50)] as DomainEvent[]
    await store.append(events)

    const first = await outbox.nextBatch(2)
    expect(first.map((e) => e.id)).toEqual([events[0]!.id, events[1]!.id])

    await outbox.acknowledge(first.map((e) => e.id))
    const second = await outbox.nextBatch(2)
    expect(second.map((e) => e.id)).toEqual([events[2]!.id])
  })

  it('ignore un id orphelin dont l’événement a disparu', async () => {
    // Ne devrait pas arriver — l'outbox s'écrit avec le journal — mais un
    // orphelin ne doit pas bloquer la file pour toujours.
    const outbox = createOutbox()
    await db.pending_push.add({ id: 'ghost' })

    expect(await outbox.nextBatch(10)).toEqual([])
  })

  it('observeCount prévient quand la file change', async () => {
    const store = createEventStore()
    const outbox = createOutbox()
    const f = createFactory()

    const seen: number[] = []
    const stop = outbox.observeCount((n) => seen.push(n))

    await store.append([f.watch()] as DomainEvent[])
    await vi.waitFor(() => {
      expect(seen).toContain(1)
    })

    stop()
  })
})
