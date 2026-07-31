import type { EventId, StoredEvent } from '@owlog/domain'

/**
 * Port de la file d'attente de synchronisation.
 *
 * Le client sait ce qui reste à pousser grâce à cette file, écrite **dans
 * la même transaction** que l'append (P1 de la revue Eng). Les deux
 * alternatives écartées, et pourquoi :
 *
 * - un curseur sur `eventsSince` devient faux dès que des événements
 *   distants s'entrelacent avec les locaux dans le journal ;
 * - un filtre `device_id` ne distingue rien : tout l'historique du temps 1
 *   porte `device_id: 'local'`.
 *
 * La file ne contient que des **identifiants** — l'événement lui-même vit
 * au journal, unique source. Un id est retiré sur acquittement du serveur,
 * jamais avant : l'app peut être tuée entre un append et un flush sans
 * rien perdre.
 */
export interface Outbox {
  /**
   * Les prochains événements à pousser, par identifiant croissant —
   * l'ordre d'écriture, puisque les UUIDv7 sont ordonnables par le temps.
   * Rend les événements joints depuis le journal, pas les ids : c'est le
   * lot que le moteur envoie tel quel.
   */
  nextBatch(limit: number): Promise<readonly StoredEvent[]>

  /** Retire de la file les ids que le serveur a acquittés. */
  acknowledge(ids: readonly EventId[]): Promise<void>

  /** Taille de la file — le « en attente » du panneau de diagnostic. */
  count(): Promise<number>

  /**
   * Remet tout le journal en file. Deux appelants : la première connexion
   * d'un appareil déjà rempli (l'historique du temps 1 n'est jamais passé
   * par l'outbox), et « re-pousser tout » de `/debug`. Idempotent côté
   * serveur — les doublons sont acquittés.
   */
  enqueueAll(): Promise<number>

  /**
   * Prévient quand la taille de la file change. C'est le déclencheur du
   * push : le moteur s'y abonne et n'a besoin d'aucun point de couture
   * dans les hooks — append, import `.log` et « re-pousser tout » passent
   * tous par la file.
   */
  observeCount(callback: (count: number) => void): () => void
}
