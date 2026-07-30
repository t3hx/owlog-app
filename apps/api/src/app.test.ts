import { SHARED_TOKEN_HEADER, type MediaDetail, type SearchResponse } from '@owlog/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from './app.ts'
import type { Config } from './config.ts'
import { UpstreamError, type TmdbClient } from './tmdb.ts'

/**
 * Routes du service.
 *
 * Les tests n'appellent jamais TMDB : le client est injecté. Ce qui est
 * vérifié ici, ce n'est pas la forme des données de TMDB — c'est le
 * comportement du proxy, qui est le seul code qu'on écrit.
 */
const CONFIG: Config = {
  port: 0,
  tmdbToken: 'tmdb-test-token',
  sharedToken: 'shared-test-token',
  allowedOrigins: [],
  trustedProxies: ['10.0.0.1'],
  basePath: '',
  databaseUrl: undefined,
  publicOrigin: undefined,
  email: undefined,
}

const HIT: SearchResponse = {
  hits: [
    {
      ref: 'tmdb:tv/95396',
      kind: 'tv',
      title: 'Severance',
      year: 2022,
      posterPath: '/poster.jpg',
    },
  ],
  count: 1,
}

const DETAIL: MediaDetail = {
  ...HIT.hits[0]!,
  backdropPath: '/backdrop.jpg',
  genres: ['Drame', 'Mystère'],
  totalRuntime: 1800,
  numberOfEpisodes: 19,
  overview: 'Mark dirige une équipe…',
  externalRatings: { tmdb: 8.4 },
}

function fakeTmdb(overrides: Partial<TmdbClient> = {}): TmdbClient {
  return {
    search: vi.fn(async () => HIT),
    detail: vi.fn(async () => DETAIL),
    ...overrides,
  }
}

function authenticated(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://local${path}`, {
    headers: { [SHARED_TOKEN_HEADER]: CONFIG.sharedToken, ...headers },
  })
}

describe('authentification', () => {
  it('refuse une requête sans jeton', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(new Request('http://local/search?q=dune'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('refuse un jeton faux', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(
      authenticated('/search?q=dune', { [SHARED_TOKEN_HEADER]: 'faux' }),
    )

    expect(response.status).toBe(401)
  })

  it('laisse passer la sonde de vie sans jeton', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    // Dokploy doit pouvoir vérifier le conteneur sans détenir le jeton.
    const response = await app.fetch(new Request('http://local/health'))

    expect(response.status).toBe(200)
  })
})

describe('recherche', () => {
  it('rend les résultats normalisés', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(authenticated('/search?q=severance'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(HIT)
  })

  it('refuse une requête vide', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(authenticated('/search?q=%20%20'))

    expect(response.status).toBe(400)
  })

  it('transmet la langue demandée', async () => {
    const tmdb = fakeTmdb()
    const app = createApp({ config: CONFIG, tmdb })

    await app.fetch(authenticated('/search?q=dune&lang=en-US'))

    expect(tmdb.search).toHaveBeenCalledWith('dune', 'en-US')
  })

  it('utilise le français par défaut', async () => {
    const tmdb = fakeTmdb()
    const app = createApp({ config: CONFIG, tmdb })

    await app.fetch(authenticated('/search?q=dune'))

    expect(tmdb.search).toHaveBeenCalledWith('dune', 'fr-FR')
  })
})

describe('cache', () => {
  it('ne rappelle pas TMDB pour la même requête', async () => {
    const tmdb = fakeTmdb()
    const app = createApp({ config: CONFIG, tmdb })

    await app.fetch(authenticated('/search?q=dune'))
    await app.fetch(authenticated('/search?q=dune'))

    // C'est le quota TMDB que le cache protège, pas la latence.
    expect(tmdb.search).toHaveBeenCalledTimes(1)
  })

  it('ignore la casse de la requête', async () => {
    const tmdb = fakeTmdb()
    const app = createApp({ config: CONFIG, tmdb })

    await app.fetch(authenticated('/search?q=Dune'))
    await app.fetch(authenticated('/search?q=dune'))

    expect(tmdb.search).toHaveBeenCalledTimes(1)
  })

  it('sépare les caches par langue', async () => {
    const tmdb = fakeTmdb()
    const app = createApp({ config: CONFIG, tmdb })

    await app.fetch(authenticated('/search?q=dune&lang=fr-FR'))
    await app.fetch(authenticated('/search?q=dune&lang=en-US'))

    // Sans ça, basculer la langue afficherait les titres de l'autre.
    expect(tmdb.search).toHaveBeenCalledTimes(2)
  })

  it('expire après vingt-quatre heures', async () => {
    let maintenant = 0
    const tmdb = fakeTmdb()
    const app = createApp({ config: CONFIG, tmdb, now: () => maintenant })

    await app.fetch(authenticated('/search?q=dune'))
    maintenant = 25 * 60 * 60 * 1000
    await app.fetch(authenticated('/search?q=dune'))

    expect(tmdb.search).toHaveBeenCalledTimes(2)
  })
})

describe('fiche média', () => {
  it('rend le détail normalisé', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(authenticated('/media/tmdb:tv/95396'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(DETAIL)
  })

  it('refuse une référence mal formée', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(authenticated('/media/imdb:tt0111161'))

    expect(response.status).toBe(400)
  })

  it('rend 404 quand TMDB ne connaît pas la référence', async () => {
    const tmdb = fakeTmdb({
      detail: vi.fn(async () => {
        throw new UpstreamError(404, null)
      }),
    })
    const app = createApp({ config: CONFIG, tmdb })

    const response = await app.fetch(authenticated('/media/tmdb:movie/999999999'))

    expect(response.status).toBe(404)
  })
})

describe('propagation des erreurs amont', () => {
  it('renvoie 429 avec le délai que TMDB indique', async () => {
    const tmdb = fakeTmdb({
      search: vi.fn(async () => {
        throw new UpstreamError(429, 17)
      }),
    })
    const app = createApp({ config: CONFIG, tmdb })

    const response = await app.fetch(authenticated('/search?q=dune'))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    // Le client doit pouvoir dire combien de temps attendre, pas afficher
    // une panne générique.
    await expect(response.json()).resolves.toEqual({
      error: 'rate-limited',
      retryAfter: 17,
    })
  })

  it('invente un délai quand TMDB n en donne pas', async () => {
    const tmdb = fakeTmdb({
      search: vi.fn(async () => {
        throw new UpstreamError(429, null)
      }),
    })
    const app = createApp({ config: CONFIG, tmdb })

    const response = await app.fetch(authenticated('/search?q=dune'))

    expect(response.headers.get('Retry-After')).toBe('10')
  })

  it('renvoie 502 pour toute autre panne amont', async () => {
    const tmdb = fakeTmdb({
      search: vi.fn(async () => {
        throw new UpstreamError(503, null)
      }),
    })
    const app = createApp({ config: CONFIG, tmdb })

    const response = await app.fetch(authenticated('/search?q=dune'))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'upstream-unavailable' })
  })
})

describe('limitation de débit', () => {
  let maintenant: number

  beforeEach(() => {
    maintenant = 0
  })

  it('coupe au-delà de la limite, sur la même IP', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb(), now: () => maintenant })
    const headers = { 'cf-connecting-ip': '203.0.113.7' }

    let last = new Response()
    for (let index = 0; index < 61; index += 1) {
      // Une requête distincte à chaque fois, sinon le cache répondrait avant
      // d'atteindre le limiteur.
      last = await app.fetch(authenticated(`/search?q=titre${index}`, headers))
    }

    expect(last.status).toBe(429)
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('compte séparément deux IP distinctes', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb(), now: () => maintenant })

    for (let index = 0; index < 60; index += 1) {
      await app.fetch(
        authenticated(`/search?q=a${index}`, { 'cf-connecting-ip': '203.0.113.7' }),
      )
    }

    const autre = await app.fetch(
      authenticated('/search?q=dune', { 'cf-connecting-ip': '203.0.113.8' }),
    )

    // Limiter sur l'IP du proxy bannirait tout le monde d'un coup.
    expect(autre.status).toBe(200)
  })
})

describe('préfixe de montage', () => {
  // En production, `owlog-api` partage son domaine avec `owlog-web` et vit
  // sous `/api`. Le service se monte lui-même sous ce préfixe plutôt que de
  // compter sur le proxy pour le retirer : rien ne garantit qu'un
  // « Strip Path » existe, et une hypothèse sur l'infrastructure ne se
  // vérifie qu'après un cycle de déploiement complet.
  const PREFIXED: Config = { ...CONFIG, basePath: '/api' }

  it('sert la sonde de vie sous le préfixe', async () => {
    const app = createApp({ config: PREFIXED, tmdb: fakeTmdb() })

    const response = await app.fetch(new Request('http://local/api/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', db: 'off' })
  })

  it('sert la recherche sous le préfixe', async () => {
    const app = createApp({ config: PREFIXED, tmdb: fakeTmdb() })

    const response = await app.fetch(
      new Request('http://local/api/search?q=dune', {
        headers: { [SHARED_TOKEN_HEADER]: PREFIXED.sharedToken },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(HIT)
  })

  it('applique le jeton partagé sous le préfixe', async () => {
    // Le middleware est monté par motif de chemin : oublier de le préfixer
    // laisserait la route ouverte sans que rien ne le signale.
    const app = createApp({ config: PREFIXED, tmdb: fakeTmdb() })

    const response = await app.fetch(new Request('http://local/api/search?q=dune'))

    expect(response.status).toBe(401)
  })

  it('sert le détail sous le préfixe', async () => {
    const app = createApp({ config: PREFIXED, tmdb: fakeTmdb() })

    const response = await app.fetch(
      new Request('http://local/api/media/tmdb:tv/95396', {
        headers: { [SHARED_TOKEN_HEADER]: PREFIXED.sharedToken },
      }),
    )

    expect(response.status).toBe(200)
  })

  it('ne répond plus à la racine quand un préfixe est posé', async () => {
    // Sinon le service resterait joignable par deux chemins, dont un que
    // personne ne surveille.
    const app = createApp({ config: PREFIXED, tmdb: fakeTmdb() })

    const response = await app.fetch(new Request('http://local/health'))

    expect(response.status).toBe(404)
  })
})

describe('état de la base', () => {
  function fakeDb(status: 'starting' | 'ok' | 'down', refresh = async () => {}) {
    // Aucun test de ce fichier ne franchit la garde : le pool ne doit
    // jamais être déréférencé.
    return { status: () => status, refresh, pool: undefined as never }
  }

  it('la sonde de vie dit « off » quand aucune base n’est configurée', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(new Request('http://local/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', db: 'off' })
  })

  it('la sonde reste verte quand la base est down — Postgres ne tue pas le proxy TMDB', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb(), db: fakeDb('down') })

    const response = await app.fetch(new Request('http://local/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', db: 'down' })
  })

  it('la sonde ne bloque jamais sur la base', async () => {
    // Un refresh qui ne répond jamais : c'est exactement une base en train
    // de tomber. La sonde répond quand même — elle lit l'état connu, elle
    // ne ping pas.
    const app = createApp({
      config: CONFIG,
      tmdb: fakeTmdb(),
      db: fakeDb('ok', () => new Promise(() => {})),
    })

    const response = await app.fetch(new Request('http://local/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', db: 'ok' })
  })

  it('/sync répond 503 quand la base est down', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb(), db: fakeDb('down') })

    const response = await app.fetch(authenticated('/sync/events'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'db-unavailable' })
  })

  it('/sync répond 503 quand aucune base n’est configurée', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb() })

    const response = await app.fetch(authenticated('/sync/events'))

    expect(response.status).toBe(503)
  })

  it('la recherche vit quand la base est down', async () => {
    const app = createApp({ config: CONFIG, tmdb: fakeTmdb(), db: fakeDb('down') })

    const response = await app.fetch(authenticated('/search?q=severance'))

    expect(response.status).toBe(200)
  })
})
