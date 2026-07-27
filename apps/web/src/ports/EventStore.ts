import type { MediaStateRow } from '@/domain/reducers/mediaState'
import type { EventId, DomainEvent, StoredEvent, MediaRef } from '@/domain/types'

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
  append(events: readonly DomainEvent[]): Promise<void>

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
   * Reconstruit intégralement `media_state` depuis les événements.
   *
   * Ce n'est pas un utilitaire de confort : depuis que la page média lit
   * elle aussi la table dérivée, c'est le chemin de réparation. Il est
   * testé et déclenchable depuis `/debug`.
   */
  rebuildAllState(): Promise<void>
}
