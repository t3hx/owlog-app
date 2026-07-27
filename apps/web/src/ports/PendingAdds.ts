/**
 * File d'ajouts hors-ligne.
 *
 * **Ce ne sont pas des événements.** Rien n'entre dans le store avant
 * confirmation : une saisie hors-ligne est un texte libre, pas encore un
 * média. Écrire un événement sur une référence provisoire obligerait à
 * inventer un espace de noms local, un événement de résolution, et une
 * règle de fusion pour le cas — nominal, pas exceptionnel — où le titre
 * saisi existe déjà en bibliothèque.
 *
 * Le seul renoncement est que le titre n'apparaît pas instantanément
 * hors-ligne. Pour un utilisateur unique, c'en est à peine un.
 */
export interface PendingAdd {
  readonly id: string
  /** Le texte tapé, tel quel. */
  readonly text: string
  readonly createdAt: string
}

export interface PendingAdds {
  add(text: string): Promise<void>
  all(): Promise<readonly PendingAdd[]>
  remove(id: string): Promise<void>
}
