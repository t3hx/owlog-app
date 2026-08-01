import type { MediaDetail, MediaRef, SearchResponse, SeasonDetail } from '@owlog/contracts'

/**
 * Port du catalogue de médias.
 *
 * Le domaine ne l'utilise pas : un visionnage se dérive d'événements, pas
 * d'une API tierce. C'est l'UI qui s'en sert, pour chercher un titre et
 * pour remplir `media_cache`.
 *
 * Les erreurs sont **rendues, pas levées**. Un réseau absent n'est pas un
 * incident : c'est un état de l'app, que l'écran doit afficher. Une
 * exception obligerait chaque appelant à envelopper son appel, et le
 * premier oubli produirait un écran blanc là où il faut un message.
 */
export interface MediaCatalog {
  search(query: string, language: string): Promise<CatalogResult<SearchResponse>>
  detail(ref: MediaRef, language: string): Promise<CatalogResult<MediaDetail>>
  /**
   * Une saison d'une série : titres d'épisodes pour la ligne sous le CTA.
   * Même promesse que les autres appels — erreurs rendues, jamais levées —
   * et l'écran qui la consomme se tait sur tout échec, hors-ligne compris.
   */
  season(
    ref: MediaRef,
    seasonNumber: number,
    language: string,
  ): Promise<CatalogResult<SeasonDetail>>
}

export type CatalogResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CatalogFailure }

/**
 * Ce qui peut mal se passer, du point de vue de l'écran.
 *
 * La granularité est celle des messages à afficher, pas celle des codes
 * HTTP : `offline` et `unavailable` produisent deux textes différents,
 * `rateLimited` en produit un troisième avec un délai.
 */
export type CatalogFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'rateLimited'; readonly retryAfter: number }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'unavailable' }
