import { db } from '@/adapters/dexie/db'
import type { SettingKey, SettingsStore } from '@/ports/SettingsStore'

/**
 * Implémentation Dexie du port SettingsStore.
 *
 * Aucun état en mémoire côté valeurs : chaque `read` interroge la base. Le
 * contrat l'exige (« une nouvelle instance relit la valeur ») parce qu'un
 * cache mémoire ici créerait deux sources de vérité pour la même donnée,
 * exactement le défaut que le modèle de lecture évite ailleurs.
 *
 * Les abonnés, eux, sont bien en mémoire : ce sont des rappels React, ils
 * ne survivent pas au rechargement par nature.
 */
export function createSettingsStore(): SettingsStore {
  const subscribers = new Map<SettingKey, Set<() => void>>()

  function notify(key: SettingKey): void {
    for (const callback of subscribers.get(key) ?? []) {
      callback()
    }
  }

  return {
    async read(key: SettingKey): Promise<string | undefined> {
      const row = await db.settings.get(key)
      return row?.value
    },

    async write(key: SettingKey, value: string): Promise<void> {
      await db.settings.put({ key, value })
      notify(key)
    },

    subscribe(key: SettingKey, callback: () => void): () => void {
      const forKey = subscribers.get(key) ?? new Set()
      forKey.add(callback)
      subscribers.set(key, forKey)

      return () => {
        forKey.delete(callback)
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
export const settingsStore = createSettingsStore()
