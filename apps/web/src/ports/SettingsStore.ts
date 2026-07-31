/**
 * Port de persistance des réglages locaux.
 *
 * Les réglages ne sont pas des événements : ils n'ont pas d'historique, pas
 * de date de survenue, et personne ne veut relire dans le journal qu'il a
 * changé son prénom. Ils vivent donc dans leur propre table, en écriture
 * directe, à côté du store d'événements qui lui est append-only.
 *
 * `subscribe` existe pour que l'UI se recalcule quand un réglage change,
 * sans que l'UI connaisse Dexie : elle relit via ce rappel. L'alternative
 * aurait été que l'adaptateur fournisse un hook React tout fait, ce qui
 * ferait remonter l'infrastructure dans la vue.
 */
export interface SettingsStore {
  /** Lit un réglage. `undefined` si la clé n'a jamais été écrite. */
  read(key: SettingKey): Promise<string | undefined>

  /** Écrit un réglage. Écrase la valeur précédente. */
  write(key: SettingKey, value: string): Promise<void>

  /**
   * Efface un réglage — la clé redevient « jamais écrite ».
   *
   * Distinct d'une valeur vide : l'existence de `syncCursor` est le bit
   * qui sépare « session expirée » (une invite) d'« aucun compte »
   * (silence). La déconnexion doit rendre ce bit à l'état vierge.
   */
  remove(key: SettingKey): Promise<void>

  /**
   * S'abonne aux changements d'une clé. Le rappel est invoqué à chaque
   * écriture de cette clé. Retourne la fonction de désabonnement.
   */
  subscribe(key: SettingKey, callback: () => void): () => void
}

/**
 * Clés connues.
 *
 * Une union fermée plutôt que `string` : une faute de frappe sur une clé
 * produirait un réglage fantôme que rien ne signalerait, et l'utilisateur
 * verrait sa préférence disparaître sans explication.
 */
export type SettingKey =
  | 'firstName'
  /**
   * Identité de l'installation, UUIDv7 minté au premier démarrage.
   * Jamais exporté dans le `.log` : voir `adapters/browser/deviceId.ts`.
   */
  | 'deviceId'
  /**
   * Curseurs de réplication (`server_seq` du journal, `updated_seq` du
   * cache), entiers sérialisés en texte. Jamais exportés dans le `.log` :
   * un curseur importé d'un autre appareil ferait sauter des pulls.
   */
  | 'syncCursor'
  | 'syncCacheCursor'
