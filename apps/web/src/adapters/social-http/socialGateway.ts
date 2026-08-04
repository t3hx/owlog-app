import {
  SHARED_TOKEN_HEADER,
  type ApiError,
  type FriendsResponse,
  type PseudoSearchResponse,
  type RelationState,
} from '@owlog/contracts'
import type { PublicProfileView } from '@owlog/domain'

import type { SocialFailure, SocialGateway, SocialResult } from '@/ports/SocialGateway'

/**
 * Adaptateur HTTP vers les routes `/social` d'`owlog-api`.
 *
 * Même forme que `authGateway` : cookie de session `HttpOnly` porté par le
 * navigateur, jeton partagé en en-tête, erreurs rendues et jamais levées.
 *
 * **Il ne réinterprète rien.** En particulier, il ne cherche pas à savoir si
 * un 404 vient d'un pseudo inconnu ou d'un compte sans relation : le
 * serveur a délibérément rendu les deux indiscernables, et un adaptateur
 * qui devinerait la différence — par un second appel, par un délai —
 * rouvrirait côté client l'oracle d'énumération que le serveur ferme.
 */
export function createSocialGateway(options: {
  baseUrl: string
  sharedToken: string
  fetchImpl?: typeof fetch
}): SocialGateway {
  const doFetch = options.fetchImpl ?? fetch
  const base = options.baseUrl.replace(/\/$/, '')

  async function call<T>(
    path: string,
    init: { method: 'GET' } | { method: 'POST'; body?: unknown },
  ): Promise<SocialResult<T>> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method,
        credentials: 'include',
        headers: {
          [SHARED_TOKEN_HEADER]: options.sharedToken,
          ...(init.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body ?? {}) } : {}),
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

  /**
   * Un pseudo dans une URL.
   *
   * Minuscules forcées ici aussi — le champ les force à la saisie, la route
   * les force à l'écriture. L'appel n'a ainsi jamais à faire confiance à son
   * appelant, et `encodeURIComponent` couvre ce qui n'a pas le bon format :
   * ce cas rend 404 côté serveur, pas une URL cassée côté client.
   */
  const asPath = (pseudo: string) => encodeURIComponent(pseudo.trim().toLowerCase())

  async function relate(path: string): Promise<SocialResult<RelationState>> {
    const result = await call<{ relation: RelationState }>(path, { method: 'POST' })
    return result.ok ? { ok: true, value: result.value.relation } : result
  }

  return {
    async search(pseudo) {
      const result = await call<PseudoSearchResponse>(
        `/social/search?pseudo=${asPath(pseudo)}`,
        { method: 'GET' },
      )
      return result.ok ? { ok: true, value: result.value.person } : result
    },

    async request(pseudo) {
      const result = await call<{ relation: RelationState }>('/social/requests', {
        method: 'POST',
        body: { pseudo: pseudo.trim().toLowerCase() },
      })
      return result.ok ? { ok: true, value: result.value.relation } : result
    },

    accept(pseudo) {
      return relate(`/social/requests/${asPath(pseudo)}/accept`)
    },

    decline(pseudo) {
      return relate(`/social/requests/${asPath(pseudo)}/decline`)
    },

    circle() {
      return call<FriendsResponse>('/social/friends', { method: 'GET' })
    },

    profile(pseudo) {
      return call<PublicProfileView>(`/social/profile/${asPath(pseudo)}`, { method: 'GET' })
    },
  }
}

async function toFailure(response: Response): Promise<SocialFailure> {
  const body = await safeJson<ApiError>(response)

  switch (body?.error) {
    case 'unauthorized':
      return { kind: 'signedOut' }
    case 'pseudo-required':
      return { kind: 'pseudoRequired' }
    case 'not-found':
      return { kind: 'notFound' }
    case 'rate-limited':
      return { kind: 'rateLimited', retryAfter: retryAfterOf(response, body) }
    default:
      return response.status === 429
        ? { kind: 'rateLimited', retryAfter: retryAfterOf(response, body) }
        : { kind: 'unavailable' }
  }
}

function retryAfterOf(response: Response, body: ApiError | null): number {
  const header = Number(response.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return header
  return body?.retryAfter ?? 60
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}
