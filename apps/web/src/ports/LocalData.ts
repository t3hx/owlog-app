/**
 * Port de la purge locale — « vider cet appareil ».
 *
 * Un seul geste, tout ou rien : journal, projections, cache média, files
 * d'attente et réglages partent ensemble. Une purge partielle laisserait
 * une app incohérente — un prénom au-dessus d'un journal vide, un curseur
 * de sync qui croit avoir tiré des événements disparus.
 *
 * La purge n'est jamais silencieuse : l'écran de confirmation dit le
 * compte exact d'événements non poussés (lu dans l'outbox), et la purge
 * inclut la déconnexion — sans elle, la session survivante retélécharge
 * tout au démarrage suivant et le geste est un no-op coûteux.
 */
export interface LocalData {
  purgeAll(): Promise<void>
}
