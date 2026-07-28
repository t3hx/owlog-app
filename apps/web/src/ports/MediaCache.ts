import { parseMediaRef, type MediaDetail, type MediaKind, type MediaRef } from '@owlog/contracts'

/**
 * Ligne de cache d'un média.
 *
 * **Ce n'est pas de la donnée utilisateur.** C'est une copie locale de ce
 * que TMDB sait d'un titre, gardée pour que la bibliothèque s'affiche hors
 * ligne. La perdre ne perd rien d'irremplaçable — contrairement au journal.
 *
 * `complete` distingue les deux moments où une ligne s'écrit : partielle à
 * l'ajout, depuis un résultat de recherche qui ne porte ni genres ni durée ;
 * complète à la première ouverture de la fiche, qui appelle `/media/:ref`.
 * Sans ce drapeau, les stats compteraient des durées absentes comme des
 * durées nulles.
 */
export interface MediaCacheRow {
  readonly ref: MediaRef
  readonly kind: MediaKind
  readonly title: string
  readonly year: number | null
  readonly posterPath: string | null
  readonly backdropPath: string | null
  readonly genres: readonly string[]
  readonly totalRuntime: number | null
  readonly numberOfEpisodes: number | null
  readonly overview: string
  readonly externalRatings: { readonly tmdb: number | null }
  readonly fetchedAt: string
  readonly complete: boolean
}

/**
 * Ligne partielle, telle qu'un résultat de recherche permet de l'écrire.
 *
 * Elle existe pour que l'ajout soit atomique : l'événement et de quoi
 * afficher le titre s'écrivent ensemble. Sans elle, couper le réseau juste
 * après un ajout laisserait une bibliothèque de références nues.
 */
export function partialCacheRow(
  hit: { ref: MediaRef; kind: MediaKind; title: string; year: number | null; posterPath: string | null },
  now: string,
): MediaCacheRow {
  return {
    ...hit,
    backdropPath: null,
    genres: [],
    totalRuntime: null,
    numberOfEpisodes: null,
    overview: '',
    externalRatings: { tmdb: null },
    fetchedAt: now,
    complete: false,
  }
}

/**
 * Ligne de secours, quand le cache ne connaît pas du tout le titre.
 *
 * Le cas est réel et pas défensif : une restauration depuis un `.log` rejoue
 * les événements et **pas** le cache TMDB. Les écrans qui listent des médias
 * s'en servent pour afficher la ligne quand même plutôt que de la sauter —
 * un compteur qui annonce trois titres au-dessus d'une liste qui en montre
 * deux se diagnostique comme une perte de données, pas comme un défaut
 * d'affichage. Ouvrir la fiche appelle `/media/:ref` et répare le cache.
 *
 * `complete: false` et `fetchedAt` vide : rien n'a été récupéré, et les
 * stats doivent pouvoir distinguer cette ligne d'une vraie.
 */
export function placeholderCacheRow(ref: MediaRef, title: string): MediaCacheRow {
  return {
    ref,
    kind: parseMediaRef(ref)?.kind ?? 'movie',
    title,
    year: null,
    posterPath: null,
    backdropPath: null,
    genres: [],
    totalRuntime: null,
    numberOfEpisodes: null,
    overview: '',
    externalRatings: { tmdb: null },
    fetchedAt: '',
    complete: false,
  }
}

/** Ligne complète, depuis la réponse de détail. */
export function completeCacheRow(detail: MediaDetail, now: string): MediaCacheRow {
  return {
    ref: detail.ref,
    kind: detail.kind,
    title: detail.title,
    year: detail.year,
    posterPath: detail.posterPath,
    backdropPath: detail.backdropPath,
    genres: detail.genres,
    totalRuntime: detail.totalRuntime,
    numberOfEpisodes: detail.numberOfEpisodes,
    overview: detail.overview,
    externalRatings: detail.externalRatings,
    fetchedAt: now,
    complete: true,
  }
}
