import type { EventId, Horodatage } from '@/domain/types'

/**
 * Ports du temps et de l'identité.
 *
 * Le domaine génère des horodatages et des UUIDv7. Sans injection, aucune
 * commande ne serait testable de façon déterministe : deux exécutions du
 * même test produiraient des identifiants et des dates différents, et la
 * règle de rang — qui départage justement sur `created_at` puis sur `id` —
 * ne pourrait pas être vérifiée du tout.
 *
 * C'est la raison pour laquelle ces deux-là sont des ports alors qu'ils
 * n'ont rien à voir avec le stockage.
 */
export interface Horloge {
  /** Instant présent, en ISO 8601 UTC. */
  maintenant(): Horodatage
}

export interface GenerateurId {
  /**
   * Nouvel identifiant d'événement.
   *
   * UUIDv7 et non v4 : ordonnable par le temps, ce qui donne un départage
   * stable et sans collision quand deux événements partagent la même date
   * de survenue — le cas courant quand on rétro-date vingt titres à
   * l'année près.
   */
  suivant(): EventId
}
