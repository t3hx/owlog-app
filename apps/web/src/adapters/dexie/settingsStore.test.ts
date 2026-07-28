import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/adapters/dexie/db'
import { createSettingsStore } from '@/adapters/dexie/settingsStore'

/**
 * Contrat du port SettingsStore.
 *
 * Ces tests tournent contre le vrai Dexie via `fake-indexeddb`, pas contre
 * un double. C'est le seul moyen de vérifier ce qui compte réellement ici :
 * qu'un réglage survit à la fermeture de l'onglet. Un double en mémoire
 * passerait au vert en ne prouvant rien.
 */
describe('SettingsStore (adaptateur Dexie)', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })

  it('rend undefined pour une clé jamais écrite', async () => {
    const store = createSettingsStore()

    await expect(store.read('firstName')).resolves.toBeUndefined()
  })

  it('relit la valeur écrite', async () => {
    const store = createSettingsStore()

    await store.write('firstName', 'Tx')

    await expect(store.read('firstName')).resolves.toBe('Tx')
  })

  it('écrase la valeur précédente', async () => {
    const store = createSettingsStore()

    await store.write('firstName', 'Tx')
    await store.write('firstName', 'Alex')

    await expect(store.read('firstName')).resolves.toBe('Alex')
  })

  it('survit à une nouvelle instance du store', async () => {
    await createSettingsStore().write('firstName', 'Tx')

    // Une nouvelle instance représente le rechargement de l'application :
    // rien ne doit vivre en mémoire dans l'adaptateur.
    await expect(createSettingsStore().read('firstName')).resolves.toBe('Tx')
  })

  it('notifie les abonnés à chaque écriture', async () => {
    const store = createSettingsStore()
    const callback = vi.fn()

    const unsubscribe = store.subscribe('firstName', callback)
    await store.write('firstName', 'Tx')

    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
    await store.write('firstName', 'Alex')

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('ne notifie pas les abonnés d\'une autre clé', async () => {
    const store = createSettingsStore()
    const callback = vi.fn()

    store.subscribe('firstName', callback)
    await db.settings.put({ key: 'autre-cle', value: 'x' })

    expect(callback).not.toHaveBeenCalled()
  })
})
