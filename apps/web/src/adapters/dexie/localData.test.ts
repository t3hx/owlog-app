import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createEventStore } from '@/adapters/dexie/eventStore'
import { createLocalData } from '@/adapters/dexie/localData'
import { createSettingsStore } from '@/adapters/dexie/settingsStore'
import { createFactory } from '@owlog/domain/test'
import type { DomainEvent } from '@owlog/domain'

/**
 * La purge locale, contre le vrai Dexie : après elle, il ne reste RIEN —
 * ni journal, ni projections, ni réglages, ni files. C'est ce qui permet à
 * l'app de retomber sur la Landing comme au premier jour, et à la
 * vérification de restauration de la CHECKLIST d'être rejouable.
 */
describe('LocalData (adaptateur Dexie)', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })

  it('efface tout, réglages compris', async () => {
    const store = createEventStore()
    const settings = createSettingsStore()
    const f = createFactory()
    await store.append([f.watch(), f.start('c1')] as DomainEvent[])
    await settings.write('firstName', 'Alex')
    await settings.write('syncCursor', '42')

    await createLocalData().purgeAll()

    for (const table of db.tables) {
      expect(await table.count(), table.name).toBe(0)
    }
  })
})
