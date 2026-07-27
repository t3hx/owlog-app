/**
 * Contrat entre `owlog-web` et `owlog-api`.
 *
 * C'est délibérément **une forme normalisée, et non le JSON de TMDB**. Le
 * client ne doit jamais dépendre de la forme d'une API tierce : le jour où
 * un champ bouge chez le fournisseur, ou le jour où une source s'ajoute, le
 * changement doit s'arrêter au proxy.
 *
 * Corollaire pratique : le bundle client ne connaît ni `poster_path` en
 * snake_case, ni `genre_ids`, ni la différence entre les réponses de
 * recherche et de détail chez TMDB.
 */

/** Type de média. TMDB renvoie aussi `person`, que le proxy filtre. */
export type MediaKind = 'movie' | 'tv'

/**
 * Référence stable d'un média.
 *
 * Le préfixe nomme la source. Il est là dès maintenant pour qu'ajouter une
 * source plus tard — livres, musique — ne demande pas de migrer les
 * événements déjà écrits.
 */
export type MediaRef = `tmdb:${MediaKind}/${number}`

/** Un résultat de recherche, tel que la liste en a besoin. */
export interface SearchHit {
  readonly ref: MediaRef
  readonly kind: MediaKind
  readonly title: string
  /** Année de sortie. `null` quand TMDB ne la connaît pas. */
  readonly year: number | null
  /** Chemin relatif, à composer avec la base d'images. `null` si absent. */
  readonly posterPath: string | null
}

export interface SearchResponse {
  readonly hits: readonly SearchHit[]
  /**
   * Nombre d'éléments **après filtrage**, sur cette page seulement.
   *
   * TMDB compte les `person` dans son total ; les afficher fausserait le
   * compteur `N résultats` de l'écran de recherche. Il n'y a pas de
   * pagination au temps 1, et l'écran le dit.
   */
  readonly count: number
}

/** Fiche complète d'un média, telle que `media_cache` la stocke. */
export interface MediaDetail extends SearchHit {
  readonly backdropPath: string | null
  /** Noms en clair. TMDB les renvoie déjà résolus sur les routes de détail. */
  readonly genres: readonly string[]
  /**
   * Durée totale en minutes.
   *
   * Films : la durée. Séries : `numberOfEpisodes × durée d'un épisode`.
   * `null` quand TMDB ne renvoie pas de quoi la calculer — le cas est
   * fréquent sur les séries, et les stats l'excluent en le disant.
   */
  readonly totalRuntime: number | null
  /** Sert l'incrément par épisode du bouton play. `null` pour un film. */
  readonly numberOfEpisodes: number | null
  readonly overview: string
  readonly externalRatings: {
    /** Note TMDB sur 10. `null` si aucun vote. */
    readonly tmdb: number | null
  }
}

/** Réponse d'erreur, uniforme sur toutes les routes. */
export interface ApiError {
  readonly error: ApiErrorCode
  /** Secondes à attendre avant de réessayer. Présent sur `rate-limited`. */
  readonly retryAfter?: number
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'rate-limited'
  | 'upstream-unavailable'
  | 'not-found'
  | 'bad-request'

/**
 * Base des images TMDB.
 *
 * Exposée ici plutôt que côté client en dur : c'est une donnée du
 * fournisseur, et elle doit changer au même endroit que le reste.
 */
export const IMAGE_BASE = 'https://image.tmdb.org/t/p'

/** Compose l'URL d'une affiche. `null` en entrée donne `null` en sortie. */
export function posterUrl(path: string | null, width: 'w185' | 'w342' | 'w500'): string | null {
  return path === null ? null : `${IMAGE_BASE}/${width}${path}`
}

/** Compose l'URL d'un fond. */
export function backdropUrl(path: string | null, width: 'w780' | 'w1280'): string | null {
  return path === null ? null : `${IMAGE_BASE}/${width}${path}`
}

/** En-tête du jeton partagé. Public par nature, il ne filtre que le bruit. */
export const SHARED_TOKEN_HEADER = 'x-owlog-token'

/** Construit une référence à partir de ses parties. */
export function mediaRef(kind: MediaKind, id: number): MediaRef {
  return `tmdb:${kind}/${id}`
}

/** Décompose une référence. `null` si elle est mal formée. */
export function parseMediaRef(ref: string): { kind: MediaKind; id: number } | null {
  const match = /^tmdb:(movie|tv)\/(\d+)$/.exec(ref)
  if (!match) return null

  const kind = match[1] as MediaKind
  const id = Number(match[2])
  return Number.isSafeInteger(id) ? { kind, id } : null
}
