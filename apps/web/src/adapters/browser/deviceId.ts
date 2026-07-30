import { uuidv7 } from 'uuidv7'

import type { SettingsStore } from '@/ports/SettingsStore'

/**
 * Identité de l'installation.
 *
 * Mintée une seule fois, au premier démarrage, puis relue : deux appareils
 * du même compte doivent rester distinguables dans le journal répliqué, et
 * un identifiant qui changerait à chaque session ferait croire à une flotte
 * d'appareils fantômes.
 *
 * Elle vit dans `settings` et **jamais dans le `.log` exporté** : importée
 * sur un autre appareil, elle ferait passer deux installations pour une
 * seule. Même règle que le curseur de sync.
 *
 * L'historique du temps 1 porte `device_id: 'local'` et le garde — le store
 * est append-only. C'est documenté, pas corrigé.
 */
export async function ensureDeviceId(settings: SettingsStore): Promise<string> {
  const known = await settings.read('deviceId')
  if (known !== undefined) return known

  const minted = uuidv7()
  await settings.write('deviceId', minted)
  return minted
}
