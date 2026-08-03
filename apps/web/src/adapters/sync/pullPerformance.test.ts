import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createEventStore } from '@/adapters/dexie/eventStore'
import type { MediaRef, StoredEvent, Timestamp } from '@owlog/domain'

/**
 * Budget de performance du pull initial — indicatif, pas un benchmark.
 *
 * La revue Eng (n°9) a écarté deux chemins :
 *
 * - `rebuildAllState()` PAR LOT : le lot N relit les événements des lots
 *   1..N — O(n²), et 10 000 événements en 20 lots relisent ~100 000
 *   lignes ;
 * - le recalcul par ref DANS chaque lot : mieux, mais un média étalé sur
 *   plusieurs lots se recalcule autant de fois qu'il a de lots.
 *
 * Le chemin retenu : `restore(refreshState: false)` par lot, puis UN
 * `rebuildAllState()` final. Ce test vérifie que ce chemin tient un
 * budget large sur 10 k événements ET que l'état dérivé qui en sort est
 * juste — la vitesse sans la justesse ne mesurerait rien.
 *
 * Le vrai budget mobile se vérifie sur téléphone réel (CHECKLIST temps 2) ;
 * la borne large d'ici ne détecte que les régressions d'algorithme, pas
 * les millisecondes.
 */
const MEDIA_COUNT = 500
const EVENTS_PER_MEDIA = 20
const BATCH = 500
const BUDGET_MS = 15_000

function tenThousandEvents(): StoredEvent[] {
  const events: StoredEvent[] = []
  let counter = 0

  const stamp = (): { id: string; created_at: Timestamp } => {
    counter += 1
    const n = String(counter).padStart(8, '0')
    return {
      id: `perf-${n}`,
      created_at: `2026-01-01T00:00:00.${String(counter % 1000).padStart(3, '0')}Z`,
    }
  }

  for (let m = 0; m < MEDIA_COUNT; m += 1) {
    const ref = `tmdb:movie/${100_000 + m}` as MediaRef
    const cycle = `cycle-${m}`
    const base = (type: string, cycleKey: string | null, payload?: unknown) => {
      const { id, created_at } = stamp()
      return {
        id,
        device_id: 'perf-device',
        type,
        media_ref: ref,
        cycle_key: cycleKey,
        created_at,
        occurred_at: created_at,
        occurred_precision: 'exact',
        ...(payload === undefined ? {} : { payload }),
      } as StoredEvent
    }

    events.push(base('WATCH', null))
    events.push(base('START', cycle))
    for (let p = 1; p <= EVENTS_PER_MEDIA - 3; p += 1) {
      events.push(base('PROG', cycle, { percent: Math.min(99, p * 6) }))
    }
    events.push(base('SEEN', cycle))
  }

  return events
}

describe('budget du pull initial', () => {
  beforeEach(async () => {
    await db.events.clear()
    await db.media_state.clear()
    await db.media_cache.clear()
    await db.pending_push.clear()
  })

  it(`restaure ${MEDIA_COUNT * EVENTS_PER_MEDIA} événements par lots, recalcul différé, sous ${BUDGET_MS / 1000} s`, async () => {
    const store = createEventStore()
    const events = tenThousandEvents()
    expect(events).toHaveLength(MEDIA_COUNT * EVENTS_PER_MEDIA)

    const startedAt = performance.now()

    for (let offset = 0; offset < events.length; offset += BATCH) {
      await store.restore(events.slice(offset, offset + BATCH), [], {
        enqueuePush: false,
        refreshState: false,
      })
    }
    await store.rebuildAllState()

    const elapsed = performance.now() - startedAt
    expect(elapsed).toBeLessThan(BUDGET_MS)

    // La vitesse sans la justesse ne mesure rien : l'état dérivé complet
    // existe et dit vrai.
    const states = await store.allMediaStates()
    expect(states).toHaveLength(MEDIA_COUNT)
    expect(states.every((row) => row.status === 'seen')).toBe(true)
  }, 30_000)
})
