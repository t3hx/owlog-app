import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createEventStore } from '@/adapters/dexie/eventStore'
import { createFactory, MOVIE, SERIES } from '@/domain/test/factory'
import type { DomainEvent } from '@/domain/types'

/**
 * Adaptateur Dexie du port EventStore.
 *
 * Ces tests tournent contre le vrai Dexie via `fake-indexeddb`, pas contre
 * un double. C'est le seul moyen de vérifier ce qui compte ici : qu'un
 * `append` est bien transactionnel, et que la table dérivée ne se
 * désaccorde jamais du journal.
 */
describe('EventStore (adaptateur Dexie)', () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.media_state.clear()
  })

  it('relit les evenements ecrits', async () => {
    const store = createEventStore()
    const f = createFactory()
    const events = [f.watch(), f.start('c1')] as DomainEvent[]

    await store.append(events)

    const relus = await store.eventsForMedia(MOVIE)
    expect(relus.map((e) => e.type)).toEqual(['WATCH', 'START'])
  })

  it('met a jour media_state dans la meme transaction', async () => {
    const store = createEventStore()
    const f = createFactory()

    await store.append([f.watch(), f.start('c1')] as DomainEvent[])

    const states = await store.allMediaStates()
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({ ref: MOVIE, status: 'watching', currentCycle: 'c1' })
  })

  it('recalcule l etat a chaque append successif', async () => {
    const store = createEventStore()
    const f = createFactory()

    await store.append([f.watch()] as DomainEvent[])
    expect((await store.allMediaStates())[0]?.status).toBe('to-watch')

    await store.append([f.start('c1')] as DomainEvent[])
    expect((await store.allMediaStates())[0]?.status).toBe('watching')

    await store.append([f.seen('c1')] as DomainEvent[])
    expect((await store.allMediaStates())[0]?.status).toBe('seen')
  })

  it('met a jour une ligne par media touche', async () => {
    const store = createEventStore()
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    await store.append([film.watch(), serie.watch(), serie.start('c1')] as DomainEvent[])

    const states = await store.allMediaStates()
    const parRef = new Map(states.map((etat) => [etat.ref, etat.status]))

    expect(parRef.get(MOVIE)).toBe('to-watch')
    expect(parRef.get(SERIES)).toBe('watching')
  })

  it('ne rend que les evenements du media demande', async () => {
    const store = createEventStore()
    const film = createFactory(MOVIE)
    const serie = createFactory(SERIES)

    await store.append([film.watch(), serie.watch(), serie.fav()] as DomainEvent[])

    expect(await store.eventsForMedia(MOVIE)).toHaveLength(1)
    expect(await store.eventsForMedia(SERIES)).toHaveLength(2)
  })

  it('accepte un append vide sans rien ecrire', async () => {
    const store = createEventStore()

    await store.append([])

    expect(await store.allMediaStates()).toHaveLength(0)
  })

  it('pagine par identifiant croissant', async () => {
    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch(), f.start('c1'), f.seen('c1')] as DomainEvent[])

    const firstPage = await store.eventsSince(null, 2)
    expect(firstPage.map((e) => e.type)).toEqual(['WATCH', 'START'])

    const second = await store.eventsSince(firstPage[1]?.id ?? null, 2)
    expect(second.map((e) => e.type)).toEqual(['SEEN'])
  })

  it('reconstruit media_state a l identique', async () => {
    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch(), f.start('c1'), f.rate('c1', 4)] as DomainEvent[])

    const avant = await store.allMediaStates()

    // On corrompt la table derivee, comme le ferait un append interrompu.
    await db.media_state.clear()
    expect(await store.allMediaStates()).toHaveLength(0)

    await store.rebuildAllState()

    expect(await store.allMediaStates()).toEqual(avant)
  })

  it('reconstruit aussi une ligne devenue fausse', async () => {
    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch(), f.start('c1')] as DomainEvent[])

    await db.media_state.update(MOVIE, { status: 'seen' })
    expect((await store.allMediaStates())[0]?.status).toBe('seen')

    await store.rebuildAllState()

    expect((await store.allMediaStates())[0]?.status).toBe('watching')
  })
})
