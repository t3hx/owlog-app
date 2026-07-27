import type { CleReglage, SettingsStore } from '@/ports/SettingsStore'

/**
 * Implémentation Dexie du port SettingsStore.
 *
 * Squelette : le contrat est posé et testé, l'implémentation arrive au
 * commit suivant. Voir CONTRIBUTING.md, le test précède le code et les deux
 * sont des commits distincts.
 */
export function creerSettingsStore(): SettingsStore {
  return {
    lire(_cle: CleReglage): Promise<string | undefined> {
      throw new Error('Pas encore implémenté')
    },
    ecrire(_cle: CleReglage, _valeur: string): Promise<void> {
      throw new Error('Pas encore implémenté')
    },
    souscrire(_cle: CleReglage, _rappel: () => void): () => void {
      throw new Error('Pas encore implémenté')
    },
  }
}
