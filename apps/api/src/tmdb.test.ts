import { describe, expect, it, vi } from 'vitest'

import { createTmdbClient, UpstreamError } from './tmdb.ts'

/**
 * Client TMDB : normalisation des formes amont.
 *
 * C'est le seul module qui connaît le snake_case de TMDB, et ces tests sont
 * la preuve qu'il ne fuit pas : ce qui sort d'ici est le contrat, rien
 * d'autre. Le réseau est injecté — aucun test n'appelle TMDB.
 */
function clientOver(payload: unknown, init: ResponseInit = {}) {
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify(payload), init),
  ) as unknown as typeof fetch
  return { client: createTmdbClient({ token: 'tmdb-test-token', fetchImpl }), fetchImpl }
}

describe('détail d’une série', () => {
  const PAYLOAD = {
    id: 95396,
    name: 'Severance',
    first_air_date: '2022-02-18',
    number_of_episodes: 19,
    number_of_seasons: 2,
    episode_run_time: [50],
  }

  it('porte le nombre de saisons', async () => {
    const { client } = clientOver(PAYLOAD)

    const detail = await client.detail('tv', 95396, 'fr-FR')

    expect(detail.numberOfSeasons).toBe(2)
  })

  it('rend null quand TMDB ne donne pas le compte de saisons', async () => {
    const { client } = clientOver({ ...PAYLOAD, number_of_seasons: undefined })

    const detail = await client.detail('tv', 95396, 'fr-FR')

    expect(detail.numberOfSeasons).toBeNull()
  })

  it('rend null sur un film — un film n a pas de saisons', async () => {
    const { client } = clientOver({ id: 438631, title: 'Dune', runtime: 155 })

    const detail = await client.detail('movie', 438631, 'fr-FR')

    expect(detail.numberOfSeasons).toBeNull()
  })
})

describe('saison d’une série', () => {
  const PAYLOAD = {
    season_number: 2,
    episodes: [
      { episode_number: 5, name: 'La balise' },
      { episode_number: 6, name: 'Le retour' },
    ],
  }

  it('appelle la route saison de TMDB avec la langue', async () => {
    const { client, fetchImpl } = clientOver(PAYLOAD)

    await client.season(95396, 2, 'fr-FR')

    const url = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as URL
    expect(String(url)).toBe('https://api.themoviedb.org/3/tv/95396/season/2?language=fr-FR')
  })

  it('normalise le numéro et le titre de chaque épisode', async () => {
    const { client } = clientOver(PAYLOAD)

    const season = await client.season(95396, 2, 'fr-FR')

    expect(season).toEqual({
      seasonNumber: 2,
      episodes: [
        { episodeNumber: 5, name: 'La balise' },
        { episodeNumber: 6, name: 'Le retour' },
      ],
    })
  })

  it('rend une chaîne vide pour un titre absent, jamais undefined', async () => {
    // Un épisode non traduit dans la langue demandée arrive sans `name`.
    // Le contrat promet une chaîne : `undefined` sérialisé disparaîtrait du
    // JSON et le client lirait un trou.
    const { client } = clientOver({
      season_number: 1,
      episodes: [{ episode_number: 1 }],
    })

    const season = await client.season(1, 1, 'fr-FR')

    expect(season.episodes).toEqual([{ episodeNumber: 1, name: '' }])
  })

  it('tolère une saison sans liste d épisodes', async () => {
    const { client } = clientOver({ season_number: 3 })

    const season = await client.season(1, 3, 'fr-FR')

    expect(season).toEqual({ seasonNumber: 3, episodes: [] })
  })

  it('propage un 404 de TMDB en UpstreamError', async () => {
    const { client } = clientOver({ status_message: 'not found' }, { status: 404 })

    await expect(client.season(95396, 99, 'fr-FR')).rejects.toThrowError(UpstreamError)
  })
})
