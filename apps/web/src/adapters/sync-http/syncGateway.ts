import {
  SHARED_TOKEN_HEADER,
  type ApiError,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@owlog/contracts'

import type { PullCursors, SyncFailure, SyncGateway, SyncResult } from '@/ports/SyncGateway'

/**
 * Adaptateur HTTP vers les routes `/sync` d'`owlog-api`.
 *
 * Mêmes règles que `tmdb-http` : les échecs sont rendus, jamais levés, et
 * le corps se lit défensivement — un proxy mal routé sert l'index de la
 * SPA avec un `200`, réponse valide pour HTTP et illisible pour nous.
 *
 * La session voyage en cookie `HttpOnly`, posé par `/auth` : cet
 * adaptateur n'y touche pas et ne le voit pas. `credentials: 'include'`
 * couvre le développement où web et api vivent sur deux ports ; en
 * production, une seule origine, le cookie part de lui-même.
 */
export function createSyncGateway(options: {
  baseUrl: string
  sharedToken: string
  fetchImpl?: typeof fetch
}): SyncGateway {
  const doFetch = options.fetchImpl ?? fetch
  const base = options.baseUrl.replace(/\/$/, '')

  async function call<T>(path: string, init: RequestInit): Promise<SyncResult<T>> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          [SHARED_TOKEN_HEADER]: options.sharedToken,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      })
    } catch {
      return { ok: false, failure: { kind: 'offline' } }
    }

    if (response.ok) {
      const parsed = await safeJson<T>(response)
      if (parsed === null) return { ok: false, failure: { kind: 'unavailable' } }
      return { ok: true, value: parsed }
    }

    return { ok: false, failure: await toFailure(response) }
  }

  return {
    push(request: PushRequest) {
      return call<PushResponse>('/sync/events', {
        method: 'POST',
        body: JSON.stringify(request),
      })
    },

    pull(cursors: PullCursors) {
      const params = new URLSearchParams({
        after: String(cursors.after),
        cacheAfter: String(cursors.cacheAfter),
      })
      return call<PullResponse>(`/sync/events?${params.toString()}`, { method: 'GET' })
    },
  }
}

async function toFailure(response: Response): Promise<SyncFailure> {
  switch (response.status) {
    case 401:
      return { kind: 'unauthorized' }
    // Le serveur en face n'a pas encore les routes /sync : « pas encore à
    // jour », pas une panne. Le moteur se tait.
    case 404:
      return { kind: 'not-deployed' }
    case 413:
      return { kind: 'payload-too-large' }
    case 429: {
      const header = Number(response.headers.get('retry-after'))
      if (Number.isFinite(header) && header > 0) {
        return { kind: 'rate-limited', retryAfter: header }
      }
      const body = await safeJson<ApiError>(response)
      return { kind: 'rate-limited', retryAfter: body?.retryAfter ?? 10 }
    }
    default:
      return { kind: 'unavailable' }
  }
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}
