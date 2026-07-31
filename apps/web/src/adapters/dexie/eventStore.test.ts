import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createEventStore } from '@/adapters/dexie/eventStore'
import { createPendingAdds } from '@/adapters/dexie/pendingAdds'
import { partialCacheRow } from '@/ports/MediaCache'
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
const HIT = {
  ref: MOVIE,
  kind: 'movie' as const,
  title: 'Dune',
  year: 2021,
  posterPath: '/dune.jpg',
}

describe('EventStore (adaptateur Dexie)', () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.media_state.clear()
    await db.media_cache.clear()
    await db.pending_push.clear()
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
    const byRef = new Map(states.map((row) => [row.ref, row.status]))

    expect(byRef.get(MOVIE)).toBe('to-watch')
    expect(byRef.get(SERIES)).toBe('watching')
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

  /**
   * Le LOG global se lit du plus récent au plus ancien.
   *
   * Le servir avec la pagination croissante obligerait à tirer toute la
   * table pour en afficher les vingt dernières lignes — le vidage que le
   * port interdit explicitement.
   */
  it('pagine aussi par identifiant decroissant', async () => {
    const store = createEventStore()
    const f = createFactory()
    await store.append([f.watch(), f.start('c1'), f.seen('c1')] as DomainEvent[])

    const firstPage = await store.eventsRecent(null, 2)
    expect(firstPage.map((e) => e.type)).toEqual(['SEEN', 'START'])

    const second = await store.eventsRecent(firstPage[1]?.id ?? null, 2)
    expect(second.map((e) => e.type)).toEqual(['WATCH'])

    // Le curseur est exclusif des deux cotes : rejouer la meme page ne doit
    // pas reafficher la ligne qui l'a bornee.
    expect(await store.eventsRecent(second[0]?.id ?? null, 2)).toHaveLength(0)
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

describe('cache média', () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.media_state.clear()
    await db.media_cache.clear()
    await db.pending_push.clear()
  })

  it('écrit la ligne de cache dans la même transaction que l événement', async () => {
    const store = createEventStore()
    const f = createFactory()

    await store.append([f.watch()] as DomainEvent[], {
      cacheRows: [partialCacheRow(HIT, '2026-07-28T10:00:00.000Z')],
    })

    const [row] = await store.mediaCache([MOVIE])
    expect(row).toMatchObject({ ref: MOVIE, title: 'Dune', complete: false })
  })

  it('rend une liste vide quand aucune référence n est demandée', async () => {
    const store = createEventStore()
    await expect(store.mediaCache([])).resolves.toEqual([])
  })

  it('ne rend que les références demandées', async () => {
    const store = createEventStore()
    const movie = createFactory(MOVIE)
    const series = createFactory(SERIES)

    await store.append([movie.watch(), series.watch()] as DomainEvent[], {
      cacheRows: [
        partialCacheRow(HIT, '2026-07-28T10:00:00.000Z'),
        partialCacheRow(
          { ref: SERIES, kind: 'tv', title: 'Severance', year: 2022, posterPath: null },
          '2026-07-28T10:00:00.000Z',
        ),
      ],
    })

    const rows = await store.mediaCache([SERIES])
    expect(rows.map((r) => r.ref)).toEqual([SERIES])
  })

  it('remplace une ligne partielle par une ligne complète', async () => {
    const store = createEventStore()
    const f = createFactory()

    await store.append([f.watch()] as DomainEvent[], {
      cacheRows: [partialCacheRow(HIT, '2026-07-28T10:00:00.000Z')],
    })
    await store.append([f.fav()] as DomainEvent[], {
      cacheRows: [
        {
          ...partialCacheRow(HIT, '2026-07-28T11:00:00.000Z'),
          genres: ['Science-Fiction'],
          totalRuntime: 155,
          complete: true,
        },
      ],
    })

    const [row] = await store.mediaCache([MOVIE])
    // C'est ce qui permet à l'ouverture d'une fiche de compléter ce que la
    // recherche n'avait pas : genres et durée.
    expect(row).toMatchObject({ complete: true, totalRuntime: 155 })
  })
})

describe('file d ajouts hors-ligne', () => {
  beforeEach(async () => {
    await db.pending_adds.clear()
  })

  it('conserve les saisies dans l ordre', async () => {
    const queue = createPendingAdds()

    await queue.add('dune')
    await queue.add('severance')

    const all = await queue.all()
    expect(all.map((entry) => entry.text)).toEqual(['dune', 'severance'])
  })

  it('ignore une saisie vide', async () => {
    const queue = createPendingAdds()
    await queue.add('   ')
    await expect(queue.all()).resolves.toHaveLength(0)
  })

  it('survit à une nouvelle instance', async () => {
    await createPendingAdds().add('dune')

    // Une saisie faite dans le métro doit être encore là le soir : un état
    // React ou sessionStorage la perdrait au premier verrouillage.
    await expect(createPendingAdds().all()).resolves.toHaveLength(1)
  })

  it('retire une entrée confirmée', async () => {
    const queue = createPendingAdds()
    await queue.add('dune')

    const [entry] = await queue.all()
    await queue.remove(entry!.id)

    await expect(queue.all()).resolves.toHaveLength(0)
  })
})

/**
 * Réinjection d'une sauvegarde.
 *
 * `restore` n'est pas `append`. Il porte des événements **déjà écrits
 * ailleurs**, il peut en croiser qui sont déjà là, et il ne doit rien casser
 * dans ce cas. Un `append` sur un identifiant existant lève, ce qui ferait
 * échouer un import à mi-parcours et laisserait la base à moitié restaurée —
 * exactement le résultat qu'une sauvegarde existe pour éviter.
 */
describe('restauration', () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.media_state.clear()
    await db.media_cache.clear()
    await db.pending_push.clear()
  })

  it('reinjecte des evenements dans une base vide', async () => {
    const store = createEventStore()
    const f = createFactory()
    const events = [f.watch(), f.start('c1'), f.seen('c1')] as DomainEvent[]

    const report = await store.restore(events, [])

    expect(report).toEqual({ added: 3, skipped: 0 })
    expect(await store.eventsForMedia(MOVIE)).toHaveLength(3)
  })

  it('recalcule la table derivee apres reinjection', async () => {
    const store = createEventStore()
    const f = createFactory()

    await store.restore([f.watch(), f.start('c1'), f.seen('c1')] as DomainEvent[], [])

    // Sans ce recalcul, la bibliotheque resterait vide apres un import
    // parfaitement reussi : les evenements sont la, la projection non.
    const [state] = await store.allMediaStates()
    expect(state).toMatchObject({ ref: MOVIE, status: 'seen', seenCount: 1 })
  })

  it('ignore ce qui est deja la, sans lever', async () => {
    const store = createEventStore()
    const f = createFactory()
    const events = [f.watch(), f.start('c1')] as DomainEvent[]

    await store.restore(events, [])
    const report = await store.restore(events, [])

    // Importer deux fois le meme fichier est un geste ordinaire. Il doit etre
    // sans effet, pas destructeur et pas fatal.
    expect(report).toEqual({ added: 0, skipped: 2 })
    expect(await store.eventsForMedia(MOVIE)).toHaveLength(2)
  })

  it('fusionne une sauvegarde partiellement connue', async () => {
    const store = createEventStore()
    const f = createFactory()
    const first = f.watch() as DomainEvent
    const second = f.start('c1') as DomainEvent

    await store.append([first])
    const report = await store.restore([first, second], [])

    expect(report).toEqual({ added: 1, skipped: 1 })
    expect(await store.eventsForMedia(MOVIE)).toHaveLength(2)
  })

  it('reamorce le cache des titres sans ecraser une ligne complete', async () => {
    const store = createEventStore()
    const f = createFactory()
    const complete = { ...partialCacheRow(HIT, 'now'), genres: ['SF'], complete: true }
    await store.append([f.watch()] as DomainEvent[], { cacheRows: [complete] })

    await store.restore([], [partialCacheRow(HIT, 'later')])

    // Le fichier ne porte que le titre et l'annee. Ecraser une ligne complete
    // avec ca perdrait genres et durees, et les stats compteraient des
    // durees absentes comme des durees nulles.
    const [row] = await store.mediaCache([MOVIE])
    expect(row).toMatchObject({ complete: true, genres: ['SF'] })
  })

  it('un quota qui deborde a mi-course annule TOUT — jamais de demi-restauration', async () => {
    // Le scenario reel : IndexedDB leve QuotaExceededError au milieu d'un
    // gros import ou d'une page de pull. Les evenements de la meme
    // transaction doivent disparaitre avec elle — une base a moitie
    // restauree est precisement ce que `restore` existe pour eviter.
    const store = createEventStore()
    const f = createFactory()
    const events = [f.watch(), f.start('c1')] as DomainEvent[]

    const quota = vi
      .spyOn(db.media_cache, 'put')
      .mockRejectedValueOnce(new DOMException('Quota exceeded', 'QuotaExceededError'))

    await expect(store.restore(events, [partialCacheRow(HIT, 'now')])).rejects.toThrow()
    quota.mockRestore()

    expect(await db.events.count()).toBe(0)
    expect(await db.pending_push.count()).toBe(0)
    expect(await db.media_state.count()).toBe(0)

    // Et parce que restore est idempotent, la reprise apres liberation
    // d'espace repart de zero, proprement.
    const retried = await store.restore(events, [partialCacheRow(HIT, 'now')])
    expect(retried).toEqual({ added: 2, skipped: 0 })
  })
})
