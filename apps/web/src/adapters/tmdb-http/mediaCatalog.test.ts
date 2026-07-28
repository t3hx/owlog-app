import { SHARED_TOKEN_HEADER, type SearchResponse } from '@owlog/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createMediaCatalog } from './mediaCatalog'

/**
 * Adaptateur HTTP vers `owlog-api`.
 *
 * Le port promet des erreurs **rendues, jamais levées** : un appelant qui
 * oublie d'envelopper son appel doit obtenir un message, pas un écran blanc.
 * Ces tests vérifient cette promesse pour chaque forme de réponse, y compris
 * celles que le service n'émet pas lui-même — un proxy mal routé rend du
 * HTML, et c'est le cas le plus probable en production, pas le plus rare.
 */
const HITS: SearchResponse = {
  hits: [
    {
      ref: 'tmdb:movie/438631',
      kind: 'movie',
      title: 'Dune',
      year: 2021,
      posterPath: '/poster.jpg',
    },
  ],
  count: 1,
}

const HTML = '<!doctype html>\n<html lang="fr"><head><title>Owlog</title></head></html>'

function catalogOver(fetchImpl: typeof fetch) {
  return createMediaCatalog({
    baseUrl: '/api',
    sharedToken: 'shared-test-token',
    fetchImpl,
  })
}

function responding(body: string, init: ResponseInit = {}): typeof fetch {
  return vi.fn(async () => new Response(body, init)) as unknown as typeof fetch
}

describe('createMediaCatalog', () => {
  it('rend la réponse quand le service répond du JSON', async () => {
    const catalog = catalogOver(
      responding(JSON.stringify(HITS), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await catalog.search('dune', 'fr-FR')

    expect(result).toEqual({ ok: true, value: HITS })
  })

  it('envoie le jeton partagé et construit une URL relative', async () => {
    const fetchImpl = responding(JSON.stringify(HITS))
    const catalog = catalogOver(fetchImpl)

    await catalog.search('blade runner', 'fr-FR')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/search?q=blade+runner&lang=fr-FR',
      { headers: { [SHARED_TOKEN_HEADER]: 'shared-test-token' } },
    )
  })

  it('traduit une panne réseau en hors-ligne', async () => {
    const catalog = catalogOver(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    )

    const result = await catalog.search('dune', 'fr-FR')

    expect(result).toEqual({ ok: false, failure: { kind: 'offline' } })
  })

  describe('réponse qui n’est pas du JSON', () => {
    // Le cas qui a mordu : `/api` mal routé, le proxy sert l'index de la SPA
    // avec un 200. La réponse est valide pour HTTP et illisible pour nous.
    it('rend un échec plutôt que de rejeter, sur un 200 en HTML', async () => {
      const catalog = catalogOver(
        responding(HTML, { headers: { 'content-type': 'text/html' } }),
      )

      const result = await catalog.search('dune', 'fr-FR')

      expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } })
    })

    it('rend un échec sur un 200 au corps vide', async () => {
      const catalog = catalogOver(responding(''))

      const result = await catalog.search('dune', 'fr-FR')

      expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } })
    })

    it('ne rejette pas non plus sur le détail', async () => {
      const catalog = catalogOver(responding(HTML))

      const result = await catalog.detail('tmdb:movie/438631', 'fr-FR')

      expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } })
    })

    it('garde le sens du code HTTP quand le corps est illisible', async () => {
      // Un 404 en HTML reste un 404 : le code porte l'information, pas le
      // corps. C'est ce qui distingue « ce titre n'existe pas » de « le
      // service est en panne ».
      const catalog = catalogOver(responding(HTML, { status: 404 }))

      const result = await catalog.detail('tmdb:movie/1', 'fr-FR')

      expect(result).toEqual({ ok: false, failure: { kind: 'notFound' } })
    })
  })

  describe('échecs du service', () => {
    it('traduit un 401 en indisponible', async () => {
      // Le jeton partagé ne correspond plus : du point de vue de l'écran,
      // le service ne répond pas utilement.
      const catalog = catalogOver(
        responding(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      )

      const result = await catalog.search('dune', 'fr-FR')

      expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } })
    })

    it('lit le délai dans l’en-tête sur un 429', async () => {
      const catalog = catalogOver(
        responding(JSON.stringify({ error: 'rate-limited', retryAfter: 3 }), {
          status: 429,
          headers: { 'retry-after': '42' },
        }),
      )

      const result = await catalog.search('dune', 'fr-FR')

      // L'en-tête fait foi, pas le corps.
      expect(result).toEqual({
        ok: false,
        failure: { kind: 'rateLimited', retryAfter: 42 },
      })
    })

    it('retombe sur le corps quand l’en-tête manque', async () => {
      const catalog = catalogOver(
        responding(JSON.stringify({ error: 'rate-limited', retryAfter: 7 }), {
          status: 429,
        }),
      )

      const result = await catalog.search('dune', 'fr-FR')

      expect(result).toEqual({
        ok: false,
        failure: { kind: 'rateLimited', retryAfter: 7 },
      })
    })

    it('retombe sur un délai par défaut quand rien n’est lisible', async () => {
      // Sans ce repli, l'écran afficherait « réessayez dans NaN secondes ».
      const catalog = catalogOver(responding(HTML, { status: 429 }))

      const result = await catalog.search('dune', 'fr-FR')

      expect(result).toEqual({
        ok: false,
        failure: { kind: 'rateLimited', retryAfter: 10 },
      })
    })
  })
})
