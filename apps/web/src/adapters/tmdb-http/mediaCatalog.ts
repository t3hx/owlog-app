import {
  SHARED_TOKEN_HEADER,
  type ApiError,
  type MediaDetail,
  type MediaRef,
  type SearchResponse,
} from '@owlog/contracts'

import type { CatalogFailure, CatalogResult, MediaCatalog } from '@/ports/MediaCatalog'

/**
 * Adaptateur HTTP vers `owlog-api`.
 *
 * Il ne connaît pas TMDB. Le proxy a déjà normalisé la réponse, et c'est
 * précisément ce qui permet de changer de fournisseur — ou d'en ajouter un
 * — sans toucher au client.
 *
 * Aucune donnée n'est mise en cache ici : `media_cache` (Dexie) est la
 * seule source du rendu hors-ligne, et TanStack Query garde le cache de
 * session en mémoire. Un troisième cache créerait une troisième vérité.
 */
export function createMediaCatalog(options: {
  baseUrl: string
  sharedToken: string
  fetchImpl?: typeof fetch
}): MediaCatalog {
  const doFetch = options.fetchImpl ?? fetch
  const base = options.baseUrl.replace(/\/$/, '')

  async function call<T>(path: string): Promise<CatalogResult<T>> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        headers: { [SHARED_TOKEN_HEADER]: options.sharedToken },
      })
    } catch {
      // `fetch` ne rejette que sur une panne réseau : c'est le mode avion,
      // le VPS injoignable, ou le DNS. Du point de vue de l'écran, c'est
      // la même chose et le même message.
      return { ok: false, failure: { kind: 'offline' } }
    }

    if (response.ok) {
      return { ok: true, value: (await response.json()) as T }
    }

    return { ok: false, failure: await toFailure(response) }
  }

  return {
    search(query, language) {
      const params = new URLSearchParams({ q: query, lang: language })
      return call<SearchResponse>(`/search?${params.toString()}`)
    },

    detail(ref: MediaRef, language) {
      const params = new URLSearchParams({ lang: language })
      return call<MediaDetail>(`/media/${ref}?${params.toString()}`)
    },
  }
}

async function toFailure(response: Response): Promise<CatalogFailure> {
  if (response.status === 404) return { kind: 'notFound' }

  if (response.status === 429) {
    // L'en-tête fait foi ; le corps ne sert que de repli, et un délai par
    // défaut évite d'afficher « réessayez dans NaN secondes ».
    const header = Number(response.headers.get('retry-after'))
    if (Number.isFinite(header) && header > 0) {
      return { kind: 'rateLimited', retryAfter: header }
    }

    const body = await safeJson(response)
    return { kind: 'rateLimited', retryAfter: body?.retryAfter ?? 10 }
  }

  return { kind: 'unavailable' }
}

async function safeJson(response: Response): Promise<ApiError | null> {
  try {
    return (await response.json()) as ApiError
  } catch {
    return null
  }
}
