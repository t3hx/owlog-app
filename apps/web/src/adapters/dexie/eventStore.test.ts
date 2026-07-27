import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { creerEventStore } from '@/adapters/dexie/eventStore'
import { creerFabrique, FILM, SERIE } from '@/domain/test/fabrique'
import type { Evenement } from '@/domain/types'

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
    const store = creerEventStore()
    const f = creerFabrique()
    const evenements = [f.watch(), f.start('c1')] as Evenement[]

    await store.append(evenements)

    const relus = await store.eventsForMedia(FILM)
    expect(relus.map((e) => e.type)).toEqual(['WATCH', 'START'])
  })

  it('met a jour media_state dans la meme transaction', async () => {
    const store = creerEventStore()
    const f = creerFabrique()

    await store.append([f.watch(), f.start('c1')] as Evenement[])

    const etats = await store.allMediaStates()
    expect(etats).toHaveLength(1)
    expect(etats[0]).toMatchObject({ ref: FILM, statut: 'en-cours', cycleCourant: 'c1' })
  })

  it('recalcule l etat a chaque append successif', async () => {
    const store = creerEventStore()
    const f = creerFabrique()

    await store.append([f.watch()] as Evenement[])
    expect((await store.allMediaStates())[0]?.statut).toBe('a-voir')

    await store.append([f.start('c1')] as Evenement[])
    expect((await store.allMediaStates())[0]?.statut).toBe('en-cours')

    await store.append([f.seen('c1')] as Evenement[])
    expect((await store.allMediaStates())[0]?.statut).toBe('vu')
  })

  it('met a jour une ligne par media touche', async () => {
    const store = creerEventStore()
    const film = creerFabrique(FILM)
    const serie = creerFabrique(SERIE)

    await store.append([film.watch(), serie.watch(), serie.start('c1')] as Evenement[])

    const etats = await store.allMediaStates()
    const parRef = new Map(etats.map((etat) => [etat.ref, etat.statut]))

    expect(parRef.get(FILM)).toBe('a-voir')
    expect(parRef.get(SERIE)).toBe('en-cours')
  })

  it('ne rend que les evenements du media demande', async () => {
    const store = creerEventStore()
    const film = creerFabrique(FILM)
    const serie = creerFabrique(SERIE)

    await store.append([film.watch(), serie.watch(), serie.fav()] as Evenement[])

    expect(await store.eventsForMedia(FILM)).toHaveLength(1)
    expect(await store.eventsForMedia(SERIE)).toHaveLength(2)
  })

  it('accepte un append vide sans rien ecrire', async () => {
    const store = creerEventStore()

    await store.append([])

    expect(await store.allMediaStates()).toHaveLength(0)
  })

  it('pagine par identifiant croissant', async () => {
    const store = creerEventStore()
    const f = creerFabrique()
    await store.append([f.watch(), f.start('c1'), f.seen('c1')] as Evenement[])

    const premiere = await store.eventsSince(null, 2)
    expect(premiere.map((e) => e.type)).toEqual(['WATCH', 'START'])

    const seconde = await store.eventsSince(premiere[1]?.id ?? null, 2)
    expect(seconde.map((e) => e.type)).toEqual(['SEEN'])
  })

  it('reconstruit media_state a l identique', async () => {
    const store = creerEventStore()
    const f = creerFabrique()
    await store.append([f.watch(), f.start('c1'), f.rate('c1', 4)] as Evenement[])

    const avant = await store.allMediaStates()

    // On corrompt la table derivee, comme le ferait un append interrompu.
    await db.media_state.clear()
    expect(await store.allMediaStates()).toHaveLength(0)

    await store.rebuildAllState()

    expect(await store.allMediaStates()).toEqual(avant)
  })

  it('reconstruit aussi une ligne devenue fausse', async () => {
    const store = creerEventStore()
    const f = creerFabrique()
    await store.append([f.watch(), f.start('c1')] as Evenement[])

    await db.media_state.update(FILM, { statut: 'vu' })
    expect((await store.allMediaStates())[0]?.statut).toBe('vu')

    await store.rebuildAllState()

    expect((await store.allMediaStates())[0]?.statut).toBe('en-cours')
  })
})
