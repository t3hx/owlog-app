import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { EventId, DomainEvent, StoredEvent, MediaRef } from '@/domain/types'
import type { MediaCacheRow } from '@/ports/MediaCache'

/**
 * Port du store d'événements.
 *
 * C'est le seul contrat qui porte la promesse « au temps 2,
 * `PostgresEventStore` implémente le même port et le domaine ne bouge pas ».
 * Il est donc écrit **en forme de requêtes, jamais en forme de vidage** :
 * aucune méthode ne rend « tous les événements de tous les médias ».
 *
 * Une méthode `allEvents()` passerait sur un IndexedDB de téléphone, et
 * obligerait Postgres à tirer la table entière à chaque affichage de la
 * bibliothèque. Le port ne serait alors pas réutilisable, et l'architecture
 * hexagonale n'aurait rien rapporté pour ce qu'elle coûte.
 *
 * Chaque méthode se traduit côté Postgres par une requête indexée sur
 * `media_ref` ou sur `id`.
 */
export interface EventStore {
  /**
   * Écrit des événements. **Transactionnel** : les événements et les lignes
   * `media_state` qu'ils affectent sont écrits ensemble, ou pas du tout.
   *
   * Une écriture partielle laisserait la table dérivée désaccordée du
   * journal, et comme la page média et la bibliothèque la lisent toutes les
   * deux, l'app afficherait deux statuts différents pour le même titre.
   */
  append(
    events: readonly DomainEvent[],
    options?: { readonly cacheRows?: readonly MediaCacheRow[] },
  ): Promise<void>

  /**
   * Lignes de cache TMDB, pour l'affichage hors-ligne.
   *
   * Séparé de `allMediaStates` : l'un est dérivé des événements et
   * appartient au domaine, l'autre est une copie d'une API tierce. Les
   * confondre ferait croire qu'un cache vidé perd de la donnée utilisateur.
   */
  mediaCache(refs: readonly MediaRef[]): Promise<readonly MediaCacheRow[]>

  /**
   * Écrit ou remplace des lignes de cache, sans toucher au journal.
   *
   * L'ouverture d'une fiche appelle `/media/:ref` et remonte genres, durée
   * totale et nombre d'épisodes, que la ligne partielle écrite à l'ajout ne
   * porte pas. `append` ne convient pas : il sort sans rien faire quand la
   * liste d'événements est vide, et une consultation n'écrit aucun événement.
   */
  upsertMediaCache(rows: readonly MediaCacheRow[]): Promise<void>

  /** Tous les événements d'un média, pour sa fiche et son journal. */
  eventsForMedia(ref: MediaRef): Promise<readonly StoredEvent[]>

  /** Les lignes dérivées, pour la bibliothèque et l'accueil. */
  allMediaStates(): Promise<readonly MediaStateRow[]>

  /**
   * Page d'événements après un curseur, par identifiant croissant.
   *
   * Sert l'export `.log`, l'écran LOG global, `/debug`, et la
   * synchronisation du temps 2. Les UUIDv7 étant ordonnables par le temps,
   * le curseur est stable.
   */
  eventsSince(cursor: EventId | null, limit: number): Promise<readonly StoredEvent[]>

  /**
   * Page d'événements **avant** un curseur, par identifiant décroissant.
   *
   * Sert le LOG global, qui se lit du plus récent au plus ancien. La
   * pagination croissante ne peut pas le servir : afficher les vingt
   * dernières lignes obligerait à tirer toute la table pour en atteindre la
   * fin, c'est-à-dire le vidage que ce port interdit.
   *
   * Le curseur est **exclusif** — passer le dernier identifiant reçu rend la
   * page suivante, jamais la même ligne deux fois. Côté Postgres :
   * `WHERE id < $1 ORDER BY id DESC LIMIT $2`, requête indexée.
   */
  eventsRecent(before: EventId | null, limit: number): Promise<readonly StoredEvent[]>

  /**
   * Réinjecte des événements déjà écrits ailleurs — sauvegarde `.log` ou
   * pull de synchronisation.
   *
   * **Ce n'est pas `append`.** Les événements arrivent avec leurs
   * identifiants d'origine, et la source peut en contenir que la base
   * connaît déjà — on réimporte deux fois, on fusionne deux appareils. Un
   * `append` lèverait sur le premier doublon et laisserait la base à moitié
   * restaurée, ce qui est précisément le résultat qu'une sauvegarde existe
   * pour éviter. `restore` est donc **idempotent par identifiant**.
   *
   * Les lignes de cache réamorcent les titres pour un retour hors ligne,
   * mais n'écrasent jamais une ligne `complete` : le fichier ne porte qu'un
   * titre et une année, et les stats distinguent une durée absente d'une
   * durée nulle.
   *
   * Les deux options distinguent les deux appelants :
   *
   * - `enqueuePush` (défaut `true`) : les événements nouveaux entrent dans
   *   l'outbox — le chemin de l'import `.log`, qui doit repartir vers le
   *   serveur. Le pull passe `false` : re-pousser ce qu'on vient de tirer
   *   serait idempotent mais doublerait le trafic.
   * - `refreshState` (défaut `true`) : recalcul immédiat des lignes
   *   dérivées touchées. Le pull **initial** passe `false` et recalcule une
   *   seule fois en fin de pull — par lot, le recalcul serait O(n²).
   */
  restore(
    events: readonly StoredEvent[],
    cacheRows: readonly MediaCacheRow[],
    options?: { readonly enqueuePush?: boolean; readonly refreshState?: boolean },
  ): Promise<RestoreReport>

  /**
   * Reconstruit intégralement `media_state` depuis les événements.
   *
   * Ce n'est pas un utilitaire de confort : depuis que la page média lit
   * elle aussi la table dérivée, c'est le chemin de réparation. Il est
   * testé et déclenchable depuis `/debug`.
   */
  rebuildAllState(): Promise<void>
}

/** Ce qu'une réinjection a réellement fait, pour le dire à l'écran. */
export interface RestoreReport {
  readonly added: number
  readonly skipped: number
}
