import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '@/adapters/dexie/db'
import type { MediaStateRow, MediaRef, StoredEvent } from '@owlog/domain'
import type { LiveQueries } from '@/ports/LiveQueries'
import type { MediaCacheRow } from '@/ports/MediaCache'
import type { PendingAdd } from '@/ports/PendingAdds'

/**
 * Hooks réactifs de l'adaptateur Dexie.
 *
 * Ils vivent ici et non dans `ui/hooks/` parce que `useLiveQuery` parle à
 * Dexie, et que l'UI n'y a pas le droit — la règle est appliquée par ESLint,
 * pas seulement écrite.
 *
 * `useLiveQuery` réinterroge à chaque écriture dans les tables lues : un
 * ajout se voit immédiatement, sans que l'appelant ait à rafraîchir quoi
 * que ce soit.
 */
export function useMediaStates(): readonly MediaStateRow[] {
  return useLiveQuery(() => db.media_state.toArray(), [], [])
}

export function useMediaCacheRows(): readonly MediaCacheRow[] {
  return useLiveQuery(() => db.media_cache.toArray(), [], [])
}

export function usePendingAdds(): readonly PendingAdd[] {
  return useLiveQuery(() => db.pending_adds.orderBy('createdAt').toArray(), [], [])
}

export function useMediaEvents(ref: MediaRef): readonly StoredEvent[] {
  return useLiveQuery(() => db.events.where('media_ref').equals(ref).toArray(), [ref], [])
}

export function useMediaState(ref: MediaRef): MediaStateRow | undefined {
  return useLiveQuery(() => db.media_state.get(ref), [ref], undefined)
}

export function useMediaCacheRow(ref: MediaRef): MediaCacheRow | undefined {
  return useLiveQuery(() => db.media_cache.get(ref), [ref], undefined)
}

export function usePendingPushCount(): number {
  return useLiveQuery(() => db.pending_push.count(), [], 0)
}

/** Implémentation du port, injectée au point d'assemblage. */
export const liveQueries: LiveQueries = {
  useMediaStates,
  usePendingAdds,
  useMediaEvents,
  useMediaState,
  useMediaCacheRow,
  useMediaCacheRows,
  usePendingPushCount,
}
