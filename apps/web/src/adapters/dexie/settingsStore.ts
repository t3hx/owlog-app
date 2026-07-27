import { db } from '@/adapters/dexie/db'
import type { CleReglage, SettingsStore } from '@/ports/SettingsStore'

/**
 * Implémentation Dexie du port SettingsStore.
 *
 * Aucun état en mémoire côté valeurs : chaque `lire` interroge la base. Le
 * contrat l'exige (« une nouvelle instance relit la valeur ») parce qu'un
 * cache mémoire ici créerait deux sources de vérité pour la même donnée,
 * exactement le défaut que le modèle de lecture évite ailleurs.
 *
 * Les abonnés, eux, sont bien en mémoire : ce sont des rappels React, ils
 * ne survivent pas au rechargement par nature.
 */
export function creerSettingsStore(): SettingsStore {
  const abonnes = new Map<CleReglage, Set<() => void>>()

  function notifier(cle: CleReglage): void {
    for (const rappel of abonnes.get(cle) ?? []) {
      rappel()
    }
  }

  return {
    async lire(cle: CleReglage): Promise<string | undefined> {
      const ligne = await db.settings.get(cle)
      return ligne?.valeur
    },

    async ecrire(cle: CleReglage, valeur: string): Promise<void> {
      await db.settings.put({ cle, valeur })
      notifier(cle)
    },

    souscrire(cle: CleReglage, rappel: () => void): () => void {
      const pourCetteCle = abonnes.get(cle) ?? new Set()
      pourCetteCle.add(rappel)
      abonnes.set(cle, pourCetteCle)

      return () => {
        pourCetteCle.delete(rappel)
      }
    },
  }
}

/**
 * Instance partagée par l'application.
 *
 * Une seule instance, sans quoi deux composants abonnés via deux instances
 * différentes ne se verraient pas mutuellement : l'un écrirait, l'autre ne
 * se recalculerait pas, et l'écran afficherait une valeur périmée.
 */
export const settingsStore = creerSettingsStore()
