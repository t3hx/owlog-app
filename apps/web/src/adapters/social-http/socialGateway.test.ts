import { describe, expect, it, vi } from 'vitest'

import { createSocialGateway } from '@/adapters/social-http/socialGateway'

/**
 * Adaptateur HTTP des routes `/social`, contre un faux `fetch`.
 *
 * Ce qui se prouve ici : la traduction des réponses du contrat en échecs
 * typés que les écrans affichent tels quels — et jamais d'exception, quelle
 * que soit la réponse.
 *
 * Trois traductions portent une décision produit, pas seulement un mapping :
 *
 * - `404` devient `notFound` **sans distinguer** « inconnu » de « privé ».
 *   Le serveur refuse de les séparer ; l'adaptateur ne doit pas réinventer
 *   la différence, sous peine de rouvrir l'oracle d'énumération côté client.
 * - `409 pseudo-required` n'est pas une erreur mais une étape manquante :
 *   l'écran emmène à Réglages au lieu d'afficher un message rouge.
 * - `401` devient `signedOut`, distinct d'`unavailable` : l'onglet Amis
 *   explique alors qu'un compte est nécessaire, il n'annonce pas une panne.
 */
const BASE = 'https://owlog.test/api'

/**
 * Une passerelle branchée sur une réponse fixe.
 *
 * `make` reconstruit la `Response` à chaque appel : un corps HTTP ne se lit
 * qu'une fois, et un test qui enchaîne deux appels sur la même instance
 * échouerait sur la seconde lecture — pas sur le code testé.
 */
function gatewayWith(make: (() => Response) | 'network-down') {
  const fetchImpl = vi.fn(() =>
    make === 'network-down'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(make()),
  )
  return {
    gateway: createSocialGateway({ baseUrl: BASE, sharedToken: 'token', fetchImpl }),
    fetchImpl,
  }
}

const PERSON = { pseudo: 'nova', memberSince: '2025-01-02T00:00:00.000Z', relation: 'none' }

describe('SocialGateway (adaptateur HTTP)', () => {
  it('cherche un pseudo en paramètre de requête, encodé', async () => {
    const { gateway, fetchImpl } = gatewayWith(() =>
      new Response(JSON.stringify({ person: PERSON }), { status: 200 }),
    )

    const result = await gateway.search('nova')

    expect(result).toEqual({ ok: true, value: PERSON })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/social/search?pseudo=nova`)
    expect(init.credentials).toBe('include')
  })

  it('rend le même échec pour un pseudo inconnu et pour un compte sans relation', async () => {
    const { gateway } = gatewayWith(() =>
      new Response(JSON.stringify({ error: 'not-found' }), { status: 404 }),
    )

    expect(await gateway.search('personne')).toEqual({
      ok: false,
      failure: { kind: 'notFound' },
    })
    expect(await gateway.profile('personne')).toEqual({
      ok: false,
      failure: { kind: 'notFound' },
    })
  })

  it('traduit l’absence de pseudo en étape manquante, pas en panne', async () => {
    const { gateway } = gatewayWith(() =>
      new Response(JSON.stringify({ error: 'pseudo-required' }), { status: 409 }),
    )

    expect(await gateway.search('nova')).toEqual({
      ok: false,
      failure: { kind: 'pseudoRequired' },
    })
  })

  it('distingue l’absence de session d’un service muet', async () => {
    const { gateway } = gatewayWith(() =>
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )

    expect(await gateway.circle()).toEqual({ ok: false, failure: { kind: 'signedOut' } })
  })

  it('porte le délai du rate-limit, en-tête d’abord', async () => {
    const { gateway } = gatewayWith(() =>
      new Response(JSON.stringify({ error: 'rate-limited', retryAfter: 600 }), {
        status: 429,
        headers: { 'retry-after': '600' },
      }),
    )

    expect(await gateway.search('nova')).toEqual({
      ok: false,
      failure: { kind: 'rateLimited', retryAfter: 600 },
    })
  })

  it('envoie une demande et rend l’état d’après', async () => {
    const { gateway, fetchImpl } = gatewayWith(() =>
      new Response(JSON.stringify({ relation: 'request-sent' }), { status: 200 }),
    )

    const result = await gateway.request('nova')

    expect(result).toEqual({ ok: true, value: 'request-sent' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/social/requests`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ pseudo: 'nova' })
  })

  it('accepte et refuse sur des chemins distincts', async () => {
    const { gateway, fetchImpl } = gatewayWith(() =>
      new Response(JSON.stringify({ relation: 'friend' }), { status: 200 }),
    )

    await gateway.accept('nova')
    await gateway.decline('theo')

    const urls = fetchImpl.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(urls).toEqual([
      `${BASE}/social/requests/nova/accept`,
      `${BASE}/social/requests/theo/decline`,
    ])
  })

  it('rend hors-ligne quand le réseau tombe, sans lever', async () => {
    const { gateway } = gatewayWith('network-down')

    expect(await gateway.circle()).toEqual({ ok: false, failure: { kind: 'offline' } })
  })

  it('rend « indisponible » sur un corps illisible plutôt que de lever', async () => {
    const { gateway } = gatewayWith(() =>
      new Response('pas du json', { status: 200 }))

    expect(await gateway.circle()).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })

  it('force les minuscules du pseudo — l’URL et le corps disent la même chose', async () => {
    // La saisie force déjà les minuscules ; l'adaptateur le refait pour que
    // l'appel n'ait jamais à faire confiance à son appelant.
    const { gateway, fetchImpl } = gatewayWith(() =>
      new Response(JSON.stringify({ person: PERSON }), { status: 200 }),
    )

    await gateway.search('NoVa')

    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toBe(`${BASE}/social/search?pseudo=nova`)
  })
})
