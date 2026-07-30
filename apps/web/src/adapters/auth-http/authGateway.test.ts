import { describe, expect, it, vi } from 'vitest'

import { createAuthGateway } from '@/adapters/auth-http/authGateway'

/**
 * Adaptateur HTTP des routes `/auth`, contre un faux `fetch`.
 *
 * Ce qui compte : la traduction des codes d'erreur du contrat
 * (`auth-invalid` avec essais restants, `auth-locked`, `rate-limited`) en
 * échecs typés que l'écran de connexion affiche tels quels — et jamais
 * d'exception, quelle que soit la réponse.
 */
const BASE = 'https://owlog.test/api'

function gatewayWith(response: Response | 'network-down') {
  const fetchImpl = vi.fn(() =>
    response === 'network-down'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(response),
  )
  return {
    gateway: createAuthGateway({ baseUrl: BASE, sharedToken: 'token', fetchImpl }),
    fetchImpl,
  }
}

describe('AuthGateway (adaptateur HTTP)', () => {
  it('demande le lien avec l’adresse et la langue', async () => {
    const { gateway, fetchImpl } = gatewayWith(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    const result = await gateway.requestLink('a@b.c', 'fr')

    expect(result.ok).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/auth/request-link`)
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.c', language: 'fr' })
  })

  it('rend l’utilisateur après un code juste', async () => {
    const { gateway } = gatewayWith(
      new Response(JSON.stringify({ user: { email: 'a@b.c', firstName: 'Alex' } }), {
        status: 200,
      }),
    )

    const result = await gateway.verifyCode('a@b.c', '123456')

    expect(result).toEqual({ ok: true, value: { email: 'a@b.c', firstName: 'Alex' } })
  })

  it('un code faux porte les essais restants — la spec impose de les afficher', async () => {
    const { gateway } = gatewayWith(
      new Response(JSON.stringify({ error: 'auth-invalid', attemptsLeft: 3 }), {
        status: 401,
      }),
    )

    const result = await gateway.verifyCode('a@b.c', '000000')

    expect(result).toEqual({ ok: false, failure: { kind: 'invalid', attemptsLeft: 3 } })
  })

  it('un jeton verrouillé se distingue d’un jeton faux', async () => {
    const { gateway } = gatewayWith(
      new Response(JSON.stringify({ error: 'auth-locked' }), { status: 401 }),
    )

    const result = await gateway.verifyCode('a@b.c', '000000')

    expect(result).toEqual({ ok: false, failure: { kind: 'locked' } })
  })

  it('le rate-limit porte son délai — le compte à rebours de « renvoyer »', async () => {
    const { gateway } = gatewayWith(
      new Response(JSON.stringify({ error: 'rate-limited', retryAfter: 900 }), {
        status: 429,
        headers: { 'retry-after': '900' },
      }),
    )

    const result = await gateway.requestLink('a@b.c', 'fr')

    expect(result).toEqual({
      ok: false,
      failure: { kind: 'rate-limited', retryAfter: 900 },
    })
  })

  it('me() sans session rend null — pas un échec', async () => {
    const { gateway } = gatewayWith(
      new Response(JSON.stringify({ user: null }), { status: 200 }),
    )

    const result = await gateway.me()

    expect(result).toEqual({ ok: true, value: null })
  })

  it('une panne réseau est un échec rendu, jamais levé', async () => {
    const { gateway } = gatewayWith('network-down')

    const result = await gateway.me()

    expect(result).toEqual({ ok: false, failure: { kind: 'offline' } })
  })

  it('un 503 de base indisponible est « unavailable »', async () => {
    const { gateway } = gatewayWith(
      new Response(JSON.stringify({ error: 'db-unavailable' }), { status: 503 }),
    )

    const result = await gateway.verifyLink('token')

    expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })
})
