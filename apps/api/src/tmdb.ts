import {
  mediaRef,
  type MediaDetail,
  type MediaKind,
  type SearchHit,
  type SearchResponse,
} from '@owlog/contracts'

/**
 * Client TMDB et normalisation.
 *
 * C'est ici, et nulle part ailleurs, que la forme de TMDB est connue. Le
 * reste du service manipule le contrat normalisé, et le client web ne voit
 * jamais un `poster_path` en snake_case.
 */

const BASE = 'https://api.themoviedb.org/3'

/**
 * Erreur d'appel amont, avec de quoi choisir le code HTTP à renvoyer.
 *
 * Les champs sont déclarés puis affectés, et non passés en propriétés de
 * paramètre. Le raccourci `constructor(readonly status: number)` génère du
 * code plutôt que d'annoter, donc `node --experimental-strip-types` le
 * refuse — et c'est exactement ainsi que le service démarre en production.
 */
export class UpstreamError extends Error {
  readonly status: number
  readonly retryAfter: number | null

  constructor(status: number, retryAfter: number | null) {
    super(`TMDB responded with ${status}`)
    this.name = 'UpstreamError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

export interface TmdbClient {
  search(query: string, language: string): Promise<SearchResponse>
  detail(kind: MediaKind, id: number, language: string): Promise<MediaDetail>
}

export function createTmdbClient(options: {
  token: string
  fetchImpl?: typeof fetch
}): TmdbClient {
  const doFetch = options.fetchImpl ?? fetch

  async function call<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    const response = await doFetch(url, {
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      // TMDB renvoie Retry-After sur ses 429. On le propage tel quel plutôt
      // que d'inventer un délai : le client saura quoi afficher.
      const header = response.headers.get('retry-after')
      const retryAfter = header === null ? null : Number(header)
      throw new UpstreamError(
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : null,
      )
    }

    return (await response.json()) as T
  }

  return {
    /**
     * Recherche multi-types.
     *
     * Un seul appel `/search/multi` plutôt qu'un appel par type. Le handoff
     * demande « un seul appel API par type sélectionné », ce qui est une
     * règle de déduplication, pas une obligation d'appeler deux fois : un
     * appel multi filtré côté serveur consomme moins de quota et répond
     * plus vite.
     *
     * TMDB mêle des `person` aux résultats. Ils sont retirés ici, et le
     * compteur renvoyé est celui d'après filtrage — laisser le total de
     * TMDB afficherait « 20 résultats » pour 12 titres visibles.
     */
    async search(query, language) {
      const payload = await call<TmdbSearchPayload>('/search/multi', {
        query,
        language,
        include_adult: 'false',
      })

      const hits = payload.results
        .filter(isMediaResult)
        .map(toSearchHit)
        .filter((hit): hit is SearchHit => hit !== null)

      return { hits, count: hits.length }
    },

    async detail(kind, id, language) {
      const payload = await call<TmdbDetailPayload>(`/${kind}/${id}`, { language })
      return toMediaDetail(kind, payload)
    },
  }
}

// --- Formes TMDB, connues seulement de ce module ---------------------------

interface TmdbSearchPayload {
  results: TmdbSearchResult[]
}

interface TmdbSearchResult {
  media_type?: string
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
}

interface TmdbDetailPayload {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
  backdrop_path?: string | null
  overview?: string
  genres?: { id: number; name: string }[]
  runtime?: number | null
  episode_run_time?: number[]
  number_of_episodes?: number | null
  vote_average?: number
  vote_count?: number
}

function isMediaResult(result: TmdbSearchResult): boolean {
  return result.media_type === 'movie' || result.media_type === 'tv'
}

function toSearchHit(result: TmdbSearchResult): SearchHit | null {
  const kind = result.media_type as MediaKind | undefined
  if (kind !== 'movie' && kind !== 'tv') return null

  const title = result.title ?? result.name
  // Un résultat sans titre n'est affichable nulle part : le laisser passer
  // produirait une ligne vide dans la liste de recherche.
  if (!title) return null

  return {
    ref: mediaRef(kind, result.id),
    kind,
    title,
    year: parseYear(result.release_date ?? result.first_air_date),
    posterPath: result.poster_path ?? null,
  }
}

function toMediaDetail(kind: MediaKind, payload: TmdbDetailPayload): MediaDetail {
  const title = payload.title ?? payload.name ?? ''

  return {
    ref: mediaRef(kind, payload.id),
    kind,
    title,
    year: parseYear(payload.release_date ?? payload.first_air_date),
    posterPath: payload.poster_path ?? null,
    backdropPath: payload.backdrop_path ?? null,
    genres: (payload.genres ?? []).map((genre) => genre.name),
    totalRuntime: totalRuntime(kind, payload),
    numberOfEpisodes: kind === 'tv' ? (payload.number_of_episodes ?? null) : null,
    overview: payload.overview ?? '',
    externalRatings: {
      // Une moyenne sans vote vaut 0 chez TMDB, ce qui n'est pas une note
      // basse mais une absence de note. L'afficher comme un 0/10 mentirait.
      tmdb: (payload.vote_count ?? 0) > 0 ? (payload.vote_average ?? null) : null,
    },
  }
}

/**
 * Durée totale, en minutes.
 *
 * Films : la durée telle quelle. Séries : le nombre d'épisodes multiplié
 * par la durée d'un épisode — `episode_run_time` est un **tableau** chez
 * TMDB, souvent vide, et c'est la raison pour laquelle les stats doivent
 * savoir exclure les séries dont la durée est inconnue.
 */
function totalRuntime(kind: MediaKind, payload: TmdbDetailPayload): number | null {
  if (kind === 'movie') return payload.runtime ?? null

  const perEpisode = payload.episode_run_time?.[0]
  const episodes = payload.number_of_episodes
  if (!perEpisode || !episodes) return null

  return perEpisode * episodes
}

function parseYear(date: string | undefined): number | null {
  if (!date) return null
  const year = Number(date.slice(0, 4))
  return Number.isSafeInteger(year) && year > 1800 ? year : null
}
