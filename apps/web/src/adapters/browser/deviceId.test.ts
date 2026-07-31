import { beforeEach, describe, expect, it } from 'vitest'

import { ensureDeviceId } from '@/adapters/browser/deviceId'
import { db } from '@/adapters/dexie/db'
import { createSettingsStore } from '@/adapters/dexie/settingsStore'

/**
 * Identité de l'installation, contre le vrai store de réglages.
 *
 * La propriété qui compte est la **stabilité** : deux lectures rendent le
 * même identifiant, sinon le journal répliqué verrait une flotte
 * d'appareils fantômes.
 */
describe('ensureDeviceId', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })

  it('minte un UUIDv7 au premier appel et le persiste', async () => {
    const settings = createSettingsStore()

    const minted = await ensureDeviceId(settings)

    expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
    expect(await settings.read('deviceId')).toBe(minted)
  })

  it('rend toujours le même identifiant ensuite', async () => {
    const settings = createSettingsStore()

    const first = await ensureDeviceId(settings)
    const second = await ensureDeviceId(settings)
    // Une nouvelle instance relit la base, pas un état en mémoire.
    const third = await ensureDeviceId(createSettingsStore())

    expect(second).toBe(first)
    expect(third).toBe(first)
  })
})
