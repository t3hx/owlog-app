import {
  SHARED_TOKEN_HEADER,
  type ApiError,
  type AuthUser,
  type MeResponse,
  type VerifyResponse,
} from '@owlog/contracts'

import type { AuthFailure, AuthGateway, AuthResult } from '@/ports/AuthGateway'

/**
 * Adaptateur HTTP vers les routes `/auth` d'`owlog-api`.
 *
 * Le cookie de session est `HttpOnly` : posé par le serveur sur les
 * réponses de vérification, envoyé par le navigateur, jamais touché ici.
 * `credentials: 'include'` couvre le développement où web et api vivent
 * sur deux ports ; en production, une seule origine.
 */
export function createAuthGateway(options: {
  baseUrl: string
  sharedToken: string
  fetchImpl?: typeof fetch
}): AuthGateway {
  const doFetch = options.fetchImpl ?? fetch
  const base = options.baseUrl.replace(/\/$/, '')

  async function call<T>(
    path: string,
    init: { method: 'GET' } | { method: 'POST'; body: unknown },
  ): Promise<AuthResult<T>> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method,
        credentials: 'include',
        headers: {
          [SHARED_TOKEN_HEADER]: options.sharedToken,
          ...(init.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
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
    async requestLink(email, language) {
      const result = await call<{ ok: boolean }>('/auth/request-link', {
        method: 'POST',
        body: { email, language },
      })
      return result.ok ? { ok: true, value: undefined } : result
    },

    async verifyCode(email, code) {
      const result = await call<VerifyResponse>('/auth/verify-code', {
        method: 'POST',
        body: { email, code },
      })
      return result.ok ? { ok: true, value: result.value.user } : result
    },

    async verifyLink(token) {
      const result = await call<VerifyResponse>('/auth/verify', {
        method: 'POST',
        body: { token },
      })
      return result.ok ? { ok: true, value: result.value.user } : result
    },

    async me() {
      const result = await call<MeResponse>('/auth/me', { method: 'GET' })
      return result.ok ? { ok: true, value: result.value.user } : result
    },

    async updateProfile(patch): Promise<AuthResult<AuthUser>> {
      // Le patch part tel quel : une clé absente du corps est ce qui dit
      // « je n'y touche pas » au serveur. La poser à `null` voudrait dire
      // « efface », ce qu'aucune rangée ne demande.
      const result = await call<VerifyResponse>('/auth/profile', {
        method: 'POST',
        body: patch,
      })
      return result.ok ? { ok: true, value: result.value.user } : result
    },

    async logout() {
      const result = await call<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        body: {},
      })
      return result.ok ? { ok: true, value: undefined } : result
    },
  }
}

async function toFailure(response: Response): Promise<AuthFailure> {
  const body = await safeJson<ApiError>(response)

  switch (body?.error) {
    case 'auth-invalid':
      return body.attemptsLeft === undefined
        ? { kind: 'invalid' }
        : { kind: 'invalid', attemptsLeft: body.attemptsLeft }
    case 'auth-locked':
      return { kind: 'locked' }
    case 'pseudo-taken':
      return { kind: 'pseudo-taken' }
    case 'rate-limited':
      return { kind: 'rate-limited', retryAfter: retryAfterOf(response, body) }
    default:
      return response.status === 429
        ? { kind: 'rate-limited', retryAfter: retryAfterOf(response, body) }
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
