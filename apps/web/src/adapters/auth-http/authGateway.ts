import {
  SHARED_TOKEN_HEADER,
  type ApiError,
  type AuthUser,
  type MeResponse,
  type OAuthProvider,
  type OAuthProvidersResponse,
  type OAuthStartResponse,
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

    async oauthProviders() {
      const result = await call<OAuthProvidersResponse>('/auth/oauth/providers', {
        method: 'GET',
      })
      return result.ok ? { ok: true as const, value: result.value.providers } : result
    },

    async oauthBegin(provider) {
      const verifier = randomSecret()
      const state = randomSecret()

      const result = await call<OAuthStartResponse>(
        `/auth/oauth/${provider}/start?challenge=${await challengeOf(verifier)}&state=${state}`,
        { method: 'GET' },
      )
      if (!result.ok) return result

      // Écrit APRÈS la réponse du serveur : un parcours qui n'a pas pu
      // commencer ne doit pas laisser derrière lui un vérificateur qui
      // ferait passer un retour étranger pour le sien.
      remember(provider, verifier, state)
      return { ok: true as const, value: { url: result.value.url } }
    },

    async oauthComplete(provider, params) {
      const kept = recall(provider)
      forget()

      // Un état qui ne correspond pas n'est pas une erreur de saisie : c'est
      // une réponse qui ne vient pas du parcours qu'on a lancé. On n'échange
      // rien — le code ne quitte même pas l'appareil.
      if (!kept || kept.state !== params.state) {
        return { ok: false as const, failure: { kind: 'invalid' as const } }
      }

      const result = await call<VerifyResponse>(`/auth/oauth/${provider}/callback`, {
        method: 'POST',
        body: { code: params.code, verifier: kept.verifier },
      })
      return result.ok ? { ok: true as const, value: result.value.user } : result
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

/**
 * Le vérificateur PKCE et l'état, entre l'aller et le retour.
 *
 * `sessionStorage` et non `localStorage` : la valeur ne sert qu'à ce
 * parcours, dans cet onglet, et elle doit disparaître avec lui. Un
 * vérificateur qui survit à la fermeture du navigateur est un secret gardé
 * sans raison.
 *
 * Le parcours passe par une navigation complète vers le fournisseur, donc
 * la mémoire du module ne suffirait pas : au retour, l'application est
 * rechargée de zéro.
 */
const STORAGE_KEY = 'owlog.oauth'

interface PendingOAuth {
  readonly provider: OAuthProvider
  readonly verifier: string
  readonly state: string
}

function remember(provider: OAuthProvider, verifier: string, state: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, verifier, state }))
  } catch {
    // Stockage refusé (navigation privée stricte) : le retour échouera sur
    // l'état manquant, ce qui est le bon comportement — mieux vaut un
    // parcours qui refuse que l'échange d'un code sans preuve de possession.
  }
}

function recall(provider: OAuthProvider): PendingOAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingOAuth>
    if (parsed.provider !== provider) return null
    if (typeof parsed.verifier !== 'string' || typeof parsed.state !== 'string') return null
    return { provider, verifier: parsed.verifier, state: parsed.state }
  } catch {
    return null
  }
}

function forget(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Rien à faire : la valeur mourra avec l'onglet.
  }
}

/** 32 octets de hasard cryptographique, en base64url — la borne haute de PKCE. */
function randomSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/**
 * Le défi PKCE : `S256`, jamais `plain`.
 *
 * `plain` envoie le vérificateur en clair dès l'aller, ce qui ne protège
 * de rien — et c'est de toute façon le seul mode que Google comme GitHub
 * acceptent (GitHub depuis juillet 2025).
 */
async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
    case 'oauth-unverified-email':
      return { kind: 'oauth-unverified-email' }
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
