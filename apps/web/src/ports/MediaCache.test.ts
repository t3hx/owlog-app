import { describe, expect, it } from 'vitest'

import { MOVIE } from '@owlog/domain/test'

import {
  MEDIA_CACHE_STALE_MS,
  completeCacheRow,
  isCacheRowStale,
  partialCacheRow,
  placeholderCacheRow,
} from '@/ports/MediaCache'

/**
 * Règle de fraîcheur de `media_cache`.
 *
 * C'est l'équivalent maison du `staleTime` de TanStack Query — qui n'est pas
 * installé ici : le cache de session est joué par Dexie et ses lectures
 * réactives. La règle vit à un seul endroit, à côté du type de la ligne,
 * et `useMedia` ne fait que l'appliquer.
 */
describe('isCacheRowStale', () => {
  const NOW = '2026-08-01T12:00:00.000Z'

  const detail = {
    ref: MOVIE,
    kind: 'movie' as const,
    title: 'Dune',
    year: 2021,
    posterPath: '/p.jpg',
    backdropPath: '/b.jpg',
    genres: ['Science-Fiction'],
    totalRuntime: 155,
    numberOfEpisodes: null,
    overview: '',
    externalRatings: { tmdb: 7.8 },
  }

  it('juge fraîche une ligne complète qui vient d’être écrite', () => {
    const row = completeCacheRow(detail, NOW)

    expect(isCacheRowStale(row, NOW)).toBe(false)
  })

  it('juge fraîche une ligne complète plus jeune que le TTL', () => {
    const fetchedAt = new Date(Date.parse(NOW) - MEDIA_CACHE_STALE_MS + 60_000).toISOString()

    expect(isCacheRowStale(completeCacheRow(detail, fetchedAt), NOW)).toBe(false)
  })

  it('juge périmée une ligne complète plus vieille que le TTL', () => {
    const fetchedAt = new Date(Date.parse(NOW) - MEDIA_CACHE_STALE_MS - 60_000).toISOString()

    expect(isCacheRowStale(completeCacheRow(detail, fetchedAt), NOW)).toBe(true)
  })

  it('juge périmée une ligne partielle, même récente', () => {
    const row = partialCacheRow(
      { ref: MOVIE, kind: 'movie', title: 'Dune', year: 2021, posterPath: null },
      NOW,
    )

    expect(isCacheRowStale(row, NOW)).toBe(true)
  })

  it('juge périmée une ligne de secours, dont le fetchedAt est vide', () => {
    expect(isCacheRowStale(placeholderCacheRow(MOVIE, 'Dune'), NOW)).toBe(true)
  })
})
