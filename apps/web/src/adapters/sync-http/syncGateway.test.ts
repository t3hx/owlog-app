import { describe, expect, it, vi } from 'vitest'

import { createSyncGateway } from '@/adapters/sync-http/syncGateway'

/**
 * Adaptateur HTTP des routes `/sync`, contre un faux `fetch`.
 *
 * Ce qui se vérifie : la traduction fidèle des statuts en échecs typés —
 * chaque code correspond à une conduite précise du moteur — et le fait
 * qu'aucune réponse, si mal formée soit-elle, ne fait LEVER l'adaptateur.
 */
const BASE = 'https://owlog.test/api'

function gatewayWith(response: Response | 'network-down') {
  const fetchImpl = vi.fn(() =>
    response === 'network-down'
      ? Promise.reject(new TypeError('fetch failed'))
      : Promise.resolve(response),
  )
  return {
    gateway: createSyncGateway({ baseUrl: BASE, sharedToken: 'token', fetchImpl }),
    fetchImpl,
  }
}

const PUSH = { events: [] }

describe('SyncGateway (adaptateur HTTP)', () => {
  it('poste le lot et rend les ids acceptés', async () => {
    const { gateway, fetchImpl } = gatewayWith(
      new Response(JSON.stringify({ accepted: ['e1'] }), { status: 200 }),
    )

    const result = await gateway.push({ events: [] })

    expect(result).toEqual({ ok: true, value: { accepted: ['e1'] } })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/sync/events`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('tire avec les deux curseurs en query', async () => {
    const { gateway, fetchImpl } = gatewayWith(
      new Response(JSON.stringify({ events: [], cacheRows: [], hasMore: false }), {
        status: 200,
      }),
    )

    const result = await gateway.pull({ after: 42, cacheAfter: 7 })

    expect(result.ok).toBe(true)
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toBe(`${BASE}/sync/events?after=42&cacheAfter=7`)
  })

  it.each([
    [401, { kind: 'unauthorized' }],
    [404, { kind: 'not-deployed' }],
    [413, { kind: 'payload-too-large' }],
    [500, { kind: 'unavailable' }],
    [503, { kind: 'unavailable' }],
  ] as const)('traduit un %i en échec typé', async (status, failure) => {
    const { gateway } = gatewayWith(new Response('{}', { status }))

    const result = await gateway.push(PUSH)

    expect(result).toEqual({ ok: false, failure })
  })

  it('lit le Retry-After d’un 429', async () => {
    const { gateway } = gatewayWith(
      new Response('{}', { status: 429, headers: { 'retry-after': '30' } }),
    )

    const result = await gateway.pull({ after: 0, cacheAfter: 0 })

    expect(result).toEqual({ ok: false, failure: { kind: 'rate-limited', retryAfter: 30 } })
  })

  it('une panne réseau est un échec rendu, jamais levé', async () => {
    const { gateway } = gatewayWith('network-down')

    const result = await gateway.pull({ after: 0, cacheAfter: 0 })

    expect(result).toEqual({ ok: false, failure: { kind: 'offline' } })
  })

  it('un 200 illisible — l’index de la SPA servie par un proxy mal routé — ne lève pas', async () => {
    const { gateway } = gatewayWith(new Response('<!doctype html>', { status: 200 }))

    const result = await gateway.pull({ after: 0, cacheAfter: 0 })

    expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } })
  })
})
